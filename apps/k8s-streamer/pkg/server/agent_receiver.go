package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	ws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

var agentSessionSeq atomic.Uint64

var agentUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024 * 1024, // 1MB buffer
	WriteBufferSize: 1024 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Agents are external cluster pods / CLI tools
	},
}

type outboundAgentMsg struct {
	msgType int
	payload []byte
	flushed chan struct{}
}

type agentOutboundWriter struct {
	clusterID string
	conn      *websocket.Conn
	sendCh    chan outboundAgentMsg
	done      chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
}

func newAgentOutboundWriter(clusterID string, conn *websocket.Conn) *agentOutboundWriter {
	w := &agentOutboundWriter{
		clusterID: clusterID,
		conn:      conn,
		sendCh:    make(chan outboundAgentMsg, 256),
		done:      make(chan struct{}),
	}
	w.wg.Add(1)
	go w.writeLoop()
	return w
}

func (w *agentOutboundWriter) writeLoop() {
	defer w.wg.Done()
	for {
		select {
		case msg := <-w.sendCh:
			_ = w.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err := w.conn.WriteMessage(msg.msgType, msg.payload)
			if msg.flushed != nil {
				close(msg.flushed)
			}
			if err != nil {
				w.closeSignalOnly()
				return
			}
		case <-w.done:
			return
		}
	}
}

func (w *agentOutboundWriter) enqueue(msgType int, payload []byte, waitFlush bool) error {
	select {
	case <-w.done:
		return fmt.Errorf("agent writer closed")
	default:
	}

	var flushed chan struct{}
	if waitFlush {
		flushed = make(chan struct{})
	}
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case w.sendCh <- outboundAgentMsg{msgType: msgType, payload: payload, flushed: flushed}:
	case <-w.done:
		return fmt.Errorf("agent writer closed")
	case <-timer.C:
		return fmt.Errorf("agent outbound write buffer full")
	}

	if flushed != nil {
		select {
		case <-flushed:
		case <-w.done:
		case <-time.After(250 * time.Millisecond):
		}
	}
	return nil
}

func (w *agentOutboundWriter) SendEvent(event string, payload any) error {
	return w.sendEvent(event, payload, false)
}

func (w *agentOutboundWriter) SendEventAndFlush(event string, payload any) error {
	return w.sendEvent(event, payload, true)
}

func (w *agentOutboundWriter) sendEvent(event string, payload any, waitFlush bool) error {
	env := types.WSEventEnvelope{
		Event:     event,
		ClusterID: w.clusterID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Data:      payload,
	}
	raw, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return w.enqueue(websocket.TextMessage, raw, waitFlush)
}

func (w *agentOutboundWriter) SendText(raw []byte) error {
	return w.enqueue(websocket.TextMessage, raw, false)
}

func (w *agentOutboundWriter) SendPong() error {
	return w.enqueue(websocket.PongMessage, nil, false)
}

func (w *agentOutboundWriter) closeSignalOnly() {
	w.closeOnce.Do(func() {
		close(w.done)
	})
}

func (w *agentOutboundWriter) Close() {
	w.closeSignalOnly()
	w.wg.Wait()
}

// HandleAgentWebSocket handles inbound streaming connections from remote envscale-agents
func HandleAgentWebSocket(hub *ws.Hub, clusterManager *k8s.ClusterManager, w http.ResponseWriter, r *http.Request) {
	clusterID := r.URL.Query().Get("clusterId")
	if clusterID == "" {
		http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
		return
	}

	// Verify agent authentication token strictly from Authorization header (never ?token= query param)
	// and bind strictly to target clusterId
	claims, err := ws.AuthenticateBearerRequest(r)
	if err != nil {
		if err == ws.ErrMissingToken || err == ws.ErrMissingSecret {
			if authErr := ws.CheckAgentAuthorization(nil, clusterID); authErr == nil {
				claims = nil
			} else {
				http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
				return
			}
		} else {
			http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
			return
		}
	}
	if authErr := ws.CheckAgentAuthorization(claims, clusterID); authErr != nil {
		http.Error(w, "Forbidden: "+authErr.Error(), http.StatusForbidden)
		return
	}

	conn, err := agentUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[AgentReceiver] Failed to upgrade WebSocket for cluster %s: %v", clusterID, err)
		return
	}
	defer conn.Close()

	sessionID := fmt.Sprintf("agent-sess-%d-%d", time.Now().UnixNano(), agentSessionSeq.Add(1))
	clusterManager.PromoteToAgentSession(clusterID, sessionID)

	writer := newAgentOutboundWriter(clusterID, conn)
	defer writer.Close()

	clusterManager.AgentRegistry().SessionHub().AttachSession(clusterID, sessionID, writer.SendEvent)
	defer func() {
		clusterManager.AgentRegistry().SessionHub().DetachSession(clusterID, sessionID, "agent_disconnected", "Agent WebSocket disconnected")
		clusterManager.AgentRegistry().MarkDisconnectedSession(clusterID, sessionID)
	}()

	log.Printf("[AgentReceiver] Agent connected for cluster '%s' (session=%s) from %s", clusterID, sessionID, r.RemoteAddr)

	conn.SetReadLimit(16 * 1024 * 1024) // 16 MB max for high-density snapshots
	_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[AgentReceiver] Connection closed unexpectedly for cluster %s (session=%s): %v", clusterID, sessionID, err)
			} else {
				log.Printf("[AgentReceiver] Agent disconnected for cluster %s (session=%s)", clusterID, sessionID)
			}
			break
		}

		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		if messageType == websocket.PingMessage {
			_ = writer.SendPong()
			continue
		}

		var envelope struct {
			Event     string          `json:"event"`
			Type      string          `json:"type"`
			ClusterID string          `json:"clusterId"`
			Data      json.RawMessage `json:"data"`
		}

		if err := json.Unmarshal(message, &envelope); err != nil {
			continue
		}

		evt := envelope.Event
		if evt == "" {
			evt = envelope.Type
		}

		switch evt {
		case types.EventAgentHello:
			var hello types.AgentHelloPayload
			if err := json.Unmarshal(envelope.Data, &hello); err == nil {
				negotiated, helloErr := clusterManager.AgentRegistry().ApplyAgentHello(clusterID, sessionID, hello)
				if errors.Is(helloErr, k8s.ErrUnsupportedAgentProtocol) {
					_ = writer.SendEventAndFlush(types.EventProtocolError, types.ProtocolErrorPayload{
						Code:              "unsupported_protocol_version",
						RequestedVersion:  hello.ProtocolVersion,
						SupportedVersions: []string{"1.0", "2.0"},
						Reason:            helloErr.Error(),
					})
					return
				}
				if helloErr == nil {
					_ = writer.SendEvent(types.EventServerHelloAck, types.ServerHelloAckPayload{
						ClusterID:       clusterID,
						SessionID:       sessionID,
						ProtocolVersion: negotiated,
					})
				}
			}
			continue

		case types.EventLogFrame, types.EventLogDiagnostic, types.EventLogStreamStatus, types.EventLogStreamEnd, types.EventLogStreamError:
			if envelope.ClusterID != "" && envelope.ClusterID != clusterID {
				continue
			}
			var frame types.LogStreamFrame
			if err := json.Unmarshal(envelope.Data, &frame); err == nil {
				if frame.ClusterID != "" && frame.ClusterID != clusterID {
					continue
				}
				if frame.SessionID != "" && frame.SessionID != sessionID {
					continue
				}
				if frame.Type == "" {
					switch evt {
					case types.EventLogDiagnostic:
						frame.Type = "diagnostic"
					case types.EventLogStreamStatus:
						frame.Type = "status"
					case types.EventLogStreamEnd:
						frame.Type = "end"
					case types.EventLogStreamError:
						frame.Type = "error"
					default:
						frame.Type = "log"
					}
				}
				clusterManager.AgentRegistry().SessionHub().DeliverLogFrame(clusterID, sessionID, frame)
			}
			continue

		case "EVENT_SNAPSHOT_SYNC":
			var snapshot types.ClusterSnapshot
			if err := json.Unmarshal(envelope.Data, &snapshot); err == nil {
				if clusterManager.AgentRegistry().SetSnapshotForSession(clusterID, sessionID, snapshot) {
					// Broadcast snapshot to frontend web clients listening on this room
					hub.RouteRaw(clusterID, message)
				}
			} else {
				log.Printf("[AgentReceiver] Error parsing snapshot from cluster %s: %v", clusterID, err)
			}
			continue

		case "ping":
			_ = writer.SendText([]byte(`{"event":"pong"}`))
			continue
		}

		// Live delta event (pod, node, deployment mutated/added/deleted)
		clusterManager.AgentRegistry().ApplyDeltaForSession(clusterID, sessionID, evt, envelope.Data)
		hub.RouteRaw(clusterID, message)
	}
}
