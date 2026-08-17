package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// Hub maintains the set of active WebSocket client connections and broadcasts messages to them.
type Hub struct {
	// Registered clients map protected by RWMutex for safe concurrent reads
	clients map[*Client]bool
	mu      sync.RWMutex

	// Inbound messages from informers to broadcast to all clients
	Broadcast chan []byte

	// Register requests from clients
	Register chan *Client

	// Unregister requests from clients
	Unregister chan *Client
}

// NewHub initializes and returns a new Hub instance
func NewHub() *Hub {
	return &Hub{
		Broadcast:  make(chan []byte, 256),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

// Run executes the hub event loop listening for register, unregister, and broadcast events
func (h *Hub) Run() {
	// Periodic heartbeat ticker to keep active client connections alive
	heartbeatTicker := time.NewTicker(30 * time.Second)
	defer heartbeatTicker.Stop()

	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("[WebSocket Hub] Client registered: %s (Total Active: %d)", client.ID, h.ClientCount())

		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				log.Printf("[WebSocket Hub] Client unregistered: %s (Total Active: %d)", client.ID, h.ClientCount())
			}
			h.mu.Unlock()

		case message := <-h.Broadcast:
			h.mu.RLock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()

		case <-heartbeatTicker.C:
			h.broadcastHeartbeat()
		}
	}
}

// ClientCount returns the number of currently connected WebSocket clients
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// BroadcastEvent helper method to serialize and emit structured event payload to all clients
func (h *Hub) BroadcastEvent(event string, clusterID string, data interface{}) {
	envelope := types.WSEventEnvelope{
		Event:     event,
		ClusterID: clusterID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Data:      data,
	}

	payload, err := json.Marshal(envelope)
	if err != nil {
		log.Printf("[WebSocket Hub] Error marshaling event %s: %v", event, err)
		return;
	}

	h.Broadcast <- payload
}

func (h *Hub) broadcastHeartbeat() {
	h.BroadcastEvent(types.EventHeartbeat, "system", map[string]interface{}{
		"activeClients": h.ClientCount(),
		"serverTime":    time.Now().UTC().Format(time.RFC3339),
	})
}
