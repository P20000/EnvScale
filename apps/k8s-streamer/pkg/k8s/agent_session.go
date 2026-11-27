package k8s

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// Session hub sentinel errors.
var (
	ErrAgentSessionUnavailable  = errors.New("agent streaming session is not connected")
	ErrTooManyAgentStreams      = errors.New("concurrent agent log stream limit reached")
	ErrDuplicateLogStreamID     = errors.New("log stream ID is already used or active")
	ErrUnsupportedAgentProtocol = errors.New("unsupported agent protocol version")
)

// AgentSendFunc delivers a control-plane event frame over the active Agent WebSocket writer.
type AgentSendFunc func(event string, payload any) error

type activeAgentSession struct {
	clusterID     string
	sessionID     string
	sendFn        AgentSendFunc
	streams       map[string]*agentStreamSub
	bufferedBytes atomic.Int64
}

// AgentSessionHub multiplexes control messages and inbound log frames across active Agent sessions.
type AgentSessionHub struct {
	mu            sync.RWMutex
	limits        AgentSessionLimits
	sessions      map[string]*activeAgentSession
	usedStreamIDs map[string]map[string]struct{} // clusterID -> set of previously issued streamIDs (prevents cross-session reuse)
}

// NewAgentSessionHub constructs an AgentSessionHub with default limits.
func NewAgentSessionHub() *AgentSessionHub {
	return &AgentSessionHub{
		limits:        DefaultAgentSessionLimits(),
		sessions:      make(map[string]*activeAgentSession),
		usedStreamIDs: make(map[string]map[string]struct{}),
	}
}

// SetLimits updates session resource bounds (for runtime tuning or adversarial tests).
func (h *AgentSessionHub) SetLimits(limits AgentSessionLimits) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if limits.MaxConcurrentStreamsPerAgent > 0 {
		h.limits.MaxConcurrentStreamsPerAgent = limits.MaxConcurrentStreamsPerAgent
	}
	if limits.MaxClusterBufferedBytes > 0 {
		h.limits.MaxClusterBufferedBytes = limits.MaxClusterBufferedBytes
	}
	if limits.MaxStreamBufferedBytes > 0 {
		h.limits.MaxStreamBufferedBytes = limits.MaxStreamBufferedBytes
	}
	if limits.MaxStreamDuration > 0 {
		h.limits.MaxStreamDuration = limits.MaxStreamDuration
	}
	if limits.MaxDroppedBeforeTerminate > 0 {
		h.limits.MaxDroppedBeforeTerminate = limits.MaxDroppedBeforeTerminate
	}
}

// AttachSession binds a newly connected Agent WebSocket writer for (clusterID, sessionID)
// and explicitly interrupts any prior session's active streams without cross-session replay.
func (h *AgentSessionHub) AttachSession(clusterID, sessionID string, sendFn AgentSendFunc) {
	if clusterID == "" || sessionID == "" || sendFn == nil {
		return
	}
	h.mu.Lock()
	prev := h.sessions[clusterID]
	var staleStreams []*agentStreamSub
	if prev != nil && prev.sessionID != sessionID {
		for _, sub := range prev.streams {
			staleStreams = append(staleStreams, sub)
		}
	}
	h.sessions[clusterID] = &activeAgentSession{
		clusterID: clusterID,
		sessionID: sessionID,
		sendFn:    sendFn,
		streams:   make(map[string]*agentStreamSub),
	}
	h.mu.Unlock()

	for _, sub := range staleStreams {
		sub.terminateWithFrame("agent_session_replaced", "interrupted", "Agent reconnected with a new session; stream interrupted")
	}
}

// DetachSession detaches sessionID only if it is still the active session for clusterID (CAS).
func (h *AgentSessionHub) DetachSession(clusterID, sessionID, code, reason string) bool {
	if clusterID == "" {
		return false
	}
	h.mu.Lock()
	cur, ok := h.sessions[clusterID]
	if !ok || cur == nil {
		h.mu.Unlock()
		return false
	}
	if sessionID != "" && cur.sessionID != sessionID {
		h.mu.Unlock()
		return false
	}
	delete(h.sessions, clusterID)
	subs := make([]*agentStreamSub, 0, len(cur.streams))
	for _, sub := range cur.streams {
		subs = append(subs, sub)
	}
	h.mu.Unlock()

	for _, sub := range subs {
		sub.terminateWithFrame(code, "interrupted", reason)
	}
	return true
}

// DetachCluster interrupts and removes any active Agent session for clusterID.
func (h *AgentSessionHub) DetachCluster(clusterID, code, reason string) {
	h.DetachSession(clusterID, "", code, reason)
	h.mu.Lock()
	delete(h.usedStreamIDs, clusterID)
	h.mu.Unlock()
}

// DetachAll interrupts all active Agent sessions across all clusters.
func (h *AgentSessionHub) DetachAll(code, reason string) {
	h.mu.Lock()
	var subs []*agentStreamSub
	for cid, cur := range h.sessions {
		for _, sub := range cur.streams {
			subs = append(subs, sub)
		}
		delete(h.sessions, cid)
	}
	h.usedStreamIDs = make(map[string]map[string]struct{})
	h.mu.Unlock()

	for _, sub := range subs {
		sub.terminateWithFrame(code, "interrupted", reason)
	}
}

func (h *AgentSessionHub) recordUsedStreamIDLocked(clusterID, streamID string) bool {
	used := h.usedStreamIDs[clusterID]
	if used == nil {
		used = make(map[string]struct{}, 64)
		h.usedStreamIDs[clusterID] = used
	}
	if _, exists := used[streamID]; exists {
		return false
	}
	if len(used) >= 10000 {
		used = make(map[string]struct{}, 64)
		h.usedStreamIDs[clusterID] = used
	}
	used[streamID] = struct{}{}
	return true
}

// OpenLogStream registers a bounded consumer sink on the active session and dispatches LOG_STREAM_START.
func (h *AgentSessionHub) OpenLogStream(
	clusterID string,
	req types.LogStreamStartPayload,
	sink chan<- types.LogStreamFrame,
) (sessionID string, done <-chan struct{}, stopFn func(reason string) error, err error) {
	if sink == nil {
		return "", nil, nil, fmt.Errorf("log sink channel is required")
	}

	h.mu.Lock()
	limits := h.limits
	sess, ok := h.sessions[clusterID]
	if !ok || sess == nil || sess.sendFn == nil {
		h.mu.Unlock()
		return "", nil, nil, fmt.Errorf("%w: no active outbound connection for cluster %s", ErrAgentSessionUnavailable, clusterID)
	}
	if _, exists := sess.streams[req.StreamID]; exists || !h.recordUsedStreamIDLocked(clusterID, req.StreamID) {
		h.mu.Unlock()
		return "", nil, nil, fmt.Errorf("%w: streamId %q cannot be reused on cluster %s", ErrDuplicateLogStreamID, req.StreamID, clusterID)
	}
	if limits.MaxConcurrentStreamsPerAgent > 0 && len(sess.streams) >= limits.MaxConcurrentStreamsPerAgent {
		h.mu.Unlock()
		return "", nil, nil, fmt.Errorf("%w: cluster %s reached limit of %d concurrent streams",
			ErrTooManyAgentStreams, clusterID, limits.MaxConcurrentStreamsPerAgent)
	}

	sub := newAgentStreamSub(req.StreamID, clusterID, sess.sessionID, sink, &sess.bufferedBytes, limits)
	sess.streams[req.StreamID] = sub
	sendFn := sess.sendFn
	sessionID = sess.sessionID
	h.mu.Unlock()

	req.ClusterID = clusterID
	req.SessionID = sessionID
	if sendErr := sendFn(types.EventLogStreamStart, req); sendErr != nil {
		h.mu.Lock()
		if cur, exists := h.sessions[clusterID]; exists && cur == sess {
			delete(cur.streams, req.StreamID)
		}
		h.mu.Unlock()
		sub.cancelImmediate()
		return "", nil, nil, fmt.Errorf("%w: failed to send LOG_STREAM_START: %v", ErrAgentSessionUnavailable, sendErr)
	}

	var stopOnce sync.Once
	stopFn = func(reason string) error {
		var sendErr error
		stopOnce.Do(func() {
			var activeSend AgentSendFunc
			h.mu.Lock()
			if cur, exists := h.sessions[clusterID]; exists && cur.sessionID == sessionID {
				delete(cur.streams, req.StreamID)
				activeSend = cur.sendFn
			}
			h.mu.Unlock()

			if activeSend != nil {
				sendErr = activeSend(types.EventLogStreamStop, types.LogStreamStopPayload{
					StreamID:  req.StreamID,
					ClusterID: clusterID,
					SessionID: sessionID,
					Reason:    reason,
				})
			}
			sub.cancelImmediate()
		})
		return sendErr
	}

	if limits.MaxStreamDuration > 0 {
		go func() {
			timer := time.NewTimer(limits.MaxStreamDuration)
			defer timer.Stop()
			select {
			case <-timer.C:
				var activeSend AgentSendFunc
				h.mu.Lock()
				if cur, exists := h.sessions[clusterID]; exists && cur.sessionID == sessionID {
					if _, active := cur.streams[req.StreamID]; active {
						delete(cur.streams, req.StreamID)
						activeSend = cur.sendFn
					}
				}
				h.mu.Unlock()
				if activeSend != nil {
					_ = activeSend(types.EventLogStreamStop, types.LogStreamStopPayload{
						StreamID:  req.StreamID,
						ClusterID: clusterID,
						SessionID: sessionID,
						Reason:    "stream_timeout",
					})
				}
				sub.terminateWithFrame("stream_timeout", "failed", fmt.Sprintf("Agent log stream exceeded maximum duration of %s", limits.MaxStreamDuration))
			case <-sub.done:
			}
		}()
	}

	return sessionID, sub.done, stopFn, nil
}

// DeliverLogFrame validates session/cluster ownership and routes frames to sub's bounded queue.
func (h *AgentSessionHub) DeliverLogFrame(clusterID, sessionID string, frame types.LogStreamFrame) bool {
	if clusterID == "" || sessionID == "" || frame.StreamID == "" {
		return false
	}
	if frame.ClusterID != "" && frame.ClusterID != clusterID {
		return false
	}
	if frame.SessionID != "" && frame.SessionID != sessionID {
		return false
	}

	isTerminal := frame.Type == "end" || frame.Type == "error" || frame.Type == "cancel"

	h.mu.Lock()
	sess, ok := h.sessions[clusterID]
	if !ok || sess == nil || sess.sessionID != sessionID {
		h.mu.Unlock()
		return false
	}
	sub, exists := sess.streams[frame.StreamID]
	if !exists || sub == nil {
		h.mu.Unlock()
		return false
	}
	if isTerminal {
		delete(sess.streams, frame.StreamID)
	}
	sendFn := sess.sendFn
	h.mu.Unlock()

	accepted, exhausted := sub.enqueue(frame)
	if exhausted {
		h.mu.Lock()
		if cur, ok := h.sessions[clusterID]; ok && cur.sessionID == sessionID {
			delete(cur.streams, frame.StreamID)
		}
		h.mu.Unlock()
		if sendFn != nil {
			_ = sendFn(types.EventLogStreamStop, types.LogStreamStopPayload{
				StreamID:  frame.StreamID,
				ClusterID: clusterID,
				SessionID: sessionID,
				Reason:    "resource_exhausted",
			})
		}
		sub.terminateWithFrame("resource_exhausted", "failed", "Stream terminated: consumer buffer and cluster byte budget exhausted")
		return false
	}
	return accepted
}

// ClusterBufferedBytes returns total queued log bytes for a connected Agent cluster.
func (h *AgentSessionHub) ClusterBufferedBytes(clusterID string) int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if sess, ok := h.sessions[clusterID]; ok && sess != nil {
		return sess.bufferedBytes.Load()
	}
	return 0
}

// SessionHub exposes the hub managing active bidirectional Agent sessions.
func (ar *AgentRegistry) SessionHub() *AgentSessionHub {
	return ar.sessionHub
}

// ApplyAgentHello strictly negotiates explicitly supported Agent Protocol versions ("1.0" or "2.0").
// Unsupported or empty versions are rejected without implicit downgrade.
func (ar *AgentRegistry) ApplyAgentHello(clusterID, sessionID string, hello types.AgentHelloPayload) (string, error) {
	if clusterID == "" {
		return "", fmt.Errorf("clusterId is required")
	}
	if hello.ProtocolVersion != "1.0" && hello.ProtocolVersion != "2.0" {
		return "", fmt.Errorf("%w: %q (supported versions: 1.0, 2.0)", ErrUnsupportedAgentProtocol, hello.ProtocolVersion)
	}

	ar.mu.Lock()
	defer ar.mu.Unlock()

	state, ok := ar.clusters[clusterID]
	if !ok || state == nil {
		return "", fmt.Errorf("agent cluster %s not registered", clusterID)
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.SessionID != "" && sessionID != "" && state.SessionID != sessionID {
		return "", fmt.Errorf("stale agent session %s", sessionID)
	}

	if hello.ProtocolVersion == "2.0" {
		if len(hello.Capabilities) > 0 {
			copied := make(map[string]types.AgentCapabilityReport, len(hello.Capabilities))
			for k, v := range hello.Capabilities {
				copied[k] = v
			}
			state.ReportedCapabilities = copied
		}
	} else {
		state.ReportedCapabilities = nil
	}

	state.ProtocolVersion = hello.ProtocolVersion
	if hello.AgentVersion != "" {
		state.AgentVersion = hello.AgentVersion
	}
	state.LastSeen = time.Now()
	state.Connected = true
	return hello.ProtocolVersion, nil
}
