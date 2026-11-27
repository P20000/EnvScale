package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
)

const (
	defaultMaxConcurrentAgentLogStreams = 32
	defaultMaxAgentAggregateBufferBytes = 8 * 1024 * 1024
)

type outboundLogMsg struct {
	payload []byte
	size    int64
}

// AgentLogLimits bounds Agent-side concurrent streams and outbound buffered bytes.
type AgentLogLimits struct {
	MaxConcurrentStreams      int
	MaxAggregateBufferedBytes int64
	MaxLineBytes              int
}

func defaultAgentLogLimits() AgentLogLimits {
	maxStreams := defaultMaxConcurrentAgentLogStreams
	if raw := os.Getenv("ENVSCALE_MAX_AGENT_LOG_STREAMS"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > 256 {
				parsed = 256
			}
			maxStreams = parsed
		}
	}
	var maxBytes int64 = defaultMaxAgentAggregateBufferBytes
	if raw := os.Getenv("ENVSCALE_MAX_AGENT_LOG_BYTES"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			if parsed < 64*1024 {
				parsed = 64 * 1024
			} else if parsed > 256*1024*1024 {
				parsed = 256 * 1024 * 1024
			}
			maxBytes = parsed
		}
	}
	maxLine := k8s.DefaultMaxLogLineBytes
	if raw := os.Getenv("ENVSCALE_MAX_LOG_LINE_BYTES"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed < 64*1024 {
				parsed = 64 * 1024
			} else if parsed > 4*1024*1024 {
				parsed = 4 * 1024 * 1024
			}
			maxLine = parsed
		}
	}
	return AgentLogLimits{
		MaxConcurrentStreams:      maxStreams,
		MaxAggregateBufferedBytes: maxBytes,
		MaxLineBytes:              maxLine,
	}
}

// LogMultiplexer manages concurrent log streams requested over a single Agent WebSocket session.
type LogMultiplexer struct {
	clusterID     string
	im            *k8s.InformerManager
	outCh         chan<- outboundLogMsg
	bufferedBytes *atomic.Int64
	limits        AgentLogLimits

	mu        sync.Mutex
	sessionID string
	streams   map[string]context.CancelFunc
	usedIDs   map[string]struct{}
	wg        sync.WaitGroup
}

func newLogMultiplexer(clusterID string, im *k8s.InformerManager, outCh chan<- outboundLogMsg, bufferedBytes *atomic.Int64, limits AgentLogLimits) *LogMultiplexer {
	if limits.MaxConcurrentStreams <= 0 {
		limits.MaxConcurrentStreams = defaultMaxConcurrentAgentLogStreams
	}
	if limits.MaxAggregateBufferedBytes <= 0 {
		limits.MaxAggregateBufferedBytes = defaultMaxAgentAggregateBufferBytes
	}
	if limits.MaxLineBytes <= 0 {
		limits.MaxLineBytes = k8s.DefaultMaxLogLineBytes
	}
	return &LogMultiplexer{
		clusterID:     clusterID,
		im:            im,
		outCh:         outCh,
		bufferedBytes: bufferedBytes,
		limits:        limits,
		streams:       make(map[string]context.CancelFunc),
		usedIDs:       make(map[string]struct{}),
	}
}

// SetSessionID updates the server-assigned sessionID from SERVER_HELLO_ACK.
func (m *LogMultiplexer) SetSessionID(sessionID string) {
	m.mu.Lock()
	m.sessionID = sessionID
	m.mu.Unlock()
}

func (m *LogMultiplexer) currentSessionID() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessionID
}

// HandleStart begins a single multiplexed log stream bound to connCtx until completed, stopped, or disconnected.
func (m *LogMultiplexer) HandleStart(connCtx context.Context, req types.LogStreamStartPayload) {
	if req.StreamID == "" {
		return
	}

	m.mu.Lock()
	curSess := m.sessionID
	if req.SessionID != "" && curSess != "" && req.SessionID != curSess {
		m.mu.Unlock()
		return
	}
	if _, exists := m.streams[req.StreamID]; exists {
		m.mu.Unlock()
		return
	}
	if _, used := m.usedIDs[req.StreamID]; used {
		m.mu.Unlock()
		m.emitControlError(connCtx, req.StreamID, curSess, "duplicate_stream_id", fmt.Sprintf("Stream ID %q already used in this Agent session", req.StreamID))
		return
	}
	if len(m.streams) >= m.limits.MaxConcurrentStreams {
		m.mu.Unlock()
		m.emitControlError(connCtx, req.StreamID, curSess, "too_many_streams", fmt.Sprintf("Agent concurrent log stream limit (%d) reached", m.limits.MaxConcurrentStreams))
		return
	}

	var clientset = m.im.StreamClientset()
	if clientset == nil {
		clientset = m.im.Clientset()
	}
	if clientset == nil {
		m.mu.Unlock()
		m.emitControlError(connCtx, req.StreamID, curSess, "cluster_unavailable", "Agent Kubernetes clientset is unavailable")
		return
	}

	streamCtx, cancel := context.WithCancel(connCtx)
	m.streams[req.StreamID] = cancel
	m.usedIDs[req.StreamID] = struct{}{}
	sessID := req.SessionID
	if sessID == "" {
		sessID = curSess
	}
	m.wg.Add(1)
	m.mu.Unlock()

	go func() {
		defer m.wg.Done()
		defer func() {
			cancel()
			m.mu.Lock()
			delete(m.streams, req.StreamID)
			m.mu.Unlock()
		}()

		frameCh := make(chan types.LogStreamFrame, 128)
		fwdDone := make(chan struct{})
		var dropped uint64
		go func() {
			defer close(fwdDone)
			for frame := range frameCh {
				if frame.SessionID == "" {
					if sessID != "" {
						frame.SessionID = sessID
					} else {
						frame.SessionID = m.currentSessionID()
					}
				}
				if dropped > 0 {
					diag := types.LogStreamFrame{
						Type:      "diagnostic",
						StreamID:  req.StreamID,
						ClusterID: m.clusterID,
						SessionID: frame.SessionID,
						Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
						Source:    "system",
						Status:    "backpressure",
						Code:      "agent_backpressure",
						Reason:    fmt.Sprintf("Agent outbound buffer backpressure: dropped %d frame(s)", dropped),
					}
					if m.forwardFrame(connCtx, diag, frame.Type == "end" || frame.Type == "error" || frame.Type == "cancel") {
						dropped = 0
					}
				}
				if !m.forwardFrame(connCtx, frame, false) {
					dropped++
				}
			}
		}()

		engine := k8s.NewLogEngine(clientset, m.clusterID, req.StreamID, sessID, frameCh)
		engine.SetLimits(m.limits.MaxLineBytes, 0, 0)
		_ = engine.Run(streamCtx, req)
		close(frameCh)
		<-fwdDone
	}()
}

// HandleStop cancels a single active stream by streamID when sessionID matches the active session.
func (m *LogMultiplexer) HandleStop(streamID, sessionID string) {
	if streamID == "" {
		return
	}
	m.mu.Lock()
	if sessionID != "" && m.sessionID != "" && sessionID != m.sessionID {
		m.mu.Unlock()
		return
	}
	cancel, ok := m.streams[streamID]
	if ok {
		delete(m.streams, streamID)
	}
	m.mu.Unlock()
	if ok && cancel != nil {
		cancel()
	}
}

// StopAll cancels every active log stream and waits for all worker goroutines to exit cleanly.
func (m *LogMultiplexer) StopAll() {
	m.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(m.streams))
	for id, cancel := range m.streams {
		cancels = append(cancels, cancel)
		delete(m.streams, id)
	}
	m.mu.Unlock()

	for _, cancel := range cancels {
		if cancel != nil {
			cancel()
		}
	}
	m.wg.Wait()
}

func (m *LogMultiplexer) emitControlError(connCtx context.Context, streamID, sessID, code, reason string) {
	m.forwardFrame(connCtx, types.LogStreamFrame{
		Type:      "error",
		StreamID:  streamID,
		ClusterID: m.clusterID,
		SessionID: sessID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Source:    "system",
		Status:    "failed",
		Code:      code,
		Reason:    reason,
	}, true)
}

func (m *LogMultiplexer) forwardFrame(connCtx context.Context, frame types.LogStreamFrame, forceWait bool) bool {
	evt := types.EventLogFrame
	switch frame.Type {
	case "diagnostic":
		evt = types.EventLogDiagnostic
	case "status":
		evt = types.EventLogStreamStatus
	case "end":
		evt = types.EventLogStreamEnd
	case "error", "cancel":
		evt = types.EventLogStreamError
	}

	env := types.WSEventEnvelope{
		Event:     evt,
		ClusterID: m.clusterID,
		Timestamp: frame.Timestamp,
		Data:      frame,
	}
	raw, err := json.Marshal(env)
	if err != nil {
		return true
	}

	sz := int64(len(raw))
	isTerminal := forceWait || frame.Type == "end" || frame.Type == "error" || frame.Type == "cancel"
	if !isTerminal && m.limits.MaxAggregateBufferedBytes > 0 && m.bufferedBytes != nil {
		if m.bufferedBytes.Load()+sz > m.limits.MaxAggregateBufferedBytes {
			return false
		}
	}

	msg := outboundLogMsg{payload: raw, size: sz}
	if isTerminal {
		timer := time.NewTimer(100 * time.Millisecond)
		defer timer.Stop()
		select {
		case m.outCh <- msg:
			if m.bufferedBytes != nil {
				m.bufferedBytes.Add(sz)
			}
			return true
		case <-timer.C:
			return false
		case <-connCtx.Done():
			return false
		}
	}

	select {
	case m.outCh <- msg:
		if m.bufferedBytes != nil {
			m.bufferedBytes.Add(sz)
		}
		return true
	case <-connCtx.Done():
		return false
	default:
		return false
	}
}
