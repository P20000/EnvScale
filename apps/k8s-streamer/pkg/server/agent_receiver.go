package server

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	ws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

var agentUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024 * 1024, // 1MB buffer
	WriteBufferSize: 1024 * 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Agents are external cluster pods / CLI tools
	},
}

// HandleAgentWebSocket handles inbound streaming connections from remote envscale-agents
func HandleAgentWebSocket(hub *ws.Hub, clusterManager *k8s.ClusterManager, w http.ResponseWriter, r *http.Request) {
	clusterID := r.URL.Query().Get("clusterId")
	if clusterID == "" {
		http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
		return
	}

	// Verify authentication token
	claims, err := ws.AuthenticateRequest(r)
	if err != nil && os.Getenv("ALLOW_ANONYMOUS_WS") != "true" {
		http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
		return
	}
	_ = claims

	conn, err := agentUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[AgentReceiver] Failed to upgrade WebSocket for cluster %s: %v", clusterID, err)
		return
	}
	defer conn.Close()

	log.Printf("[AgentReceiver] Agent connected for cluster '%s' from %s", clusterID, r.RemoteAddr)

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
				log.Printf("[AgentReceiver] Connection closed unexpectedly for cluster %s: %v", clusterID, err)
			} else {
				log.Printf("[AgentReceiver] Agent disconnected for cluster %s", clusterID)
			}
			clusterManager.AgentRegistry().MarkDisconnected(clusterID)
			break
		}

		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		if messageType == websocket.PingMessage {
			_ = conn.WriteMessage(websocket.PongMessage, nil)
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

		if evt == "EVENT_SNAPSHOT_SYNC" {
			var snapshot types.ClusterSnapshot
			if err := json.Unmarshal(envelope.Data, &snapshot); err == nil {
				clusterManager.AgentRegistry().SetSnapshot(clusterID, snapshot)
				// Broadcast snapshot to frontend web clients listening on this room
				hub.RouteRaw(clusterID, message)
			} else {
				log.Printf("[AgentReceiver] Error parsing snapshot from cluster %s: %v", clusterID, err)
			}
			continue
		}

		if evt == "ping" {
			_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"event":"pong"}`))
			continue
		}

		// Live delta event (pod, node, deployment mutated/added/deleted)
		clusterManager.AgentRegistry().ApplyDelta(clusterID, evt, envelope.Data)
		hub.RouteRaw(clusterID, message)
	}
}
