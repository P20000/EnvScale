package websocket

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// roomedMessage bundles a serialized payload with the target clusterID room for routing.
type roomedMessage struct {
	clusterID string
	payload   []byte
}

// EventPublisher is an optional hook called after every successful BroadcastEvent
// to fan-out the event to peer streamer instances (e.g. via Redis Pub/Sub).
// It receives the clusterID and the already-serialized WSEventEnvelope so it can
// publish to Redis without re-marshalling.
type EventPublisher interface {
	Publish(ctx context.Context, clusterID string, envelope types.WSEventEnvelope)
}

// Hub maintains the set of active WebSocket client connections and routes
// messages to the correct workspace/cluster room. Each client registers with
// a clusterID so that Kubernetes Informer delta events are only delivered to
// clients watching that specific cluster — preventing cross-tenant data leaks.
type Hub struct {
	// rooms maps clusterID → set of Clients subscribed to that cluster room.
	// Protected by mu for concurrent safe access.
	rooms map[string]map[*Client]bool
	mu    sync.RWMutex

	// Inbound roomed messages from Informer pipeline to dispatch to room subscribers
	broadcast chan roomedMessage

	// Register requests from clients
	Register chan *Client

	// Unregister requests from clients
	Unregister chan *Client

	// publisher is an optional fan-out hook (e.g. Redis adapter). Protected by publisherMu.
	publisher   EventPublisher
	publisherMu sync.RWMutex
}

// NewHub initializes and returns a new Hub instance with room-based routing
func NewHub() *Hub {
	return &Hub{
		rooms:      make(map[string]map[*Client]bool),
		broadcast:  make(chan roomedMessage, 512), // larger buffer for high-throughput cluster events
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
}

// SetPublisher attaches an EventPublisher (e.g. Redis adapter) to the Hub.
// After every BroadcastEvent call, the publisher hook is invoked so the event
// is also fanned out to other streamer instances. Safe to call after NewHub().
func (h *Hub) SetPublisher(p EventPublisher) {
	h.publisherMu.Lock()
	defer h.publisherMu.Unlock()
	h.publisher = p
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
			if _, ok := h.rooms[client.ClusterID]; !ok {
				h.rooms[client.ClusterID] = make(map[*Client]bool)
			}
			h.rooms[client.ClusterID][client] = true
			h.mu.Unlock()
			log.Printf("[WebSocket Hub] Client %s registered to room '%s' (Room size: %d)",
				client.ID, client.ClusterID, h.RoomSize(client.ClusterID))

		case client := <-h.Unregister:
			h.mu.Lock()
			if room, ok := h.rooms[client.ClusterID]; ok {
				if _, ok := room[client]; ok {
					delete(room, client)
					close(client.send)
					// Prune empty rooms to avoid memory leaks
					if len(room) == 0 {
						delete(h.rooms, client.ClusterID)
					}
					log.Printf("[WebSocket Hub] Client %s unregistered from room '%s'",
						client.ID, client.ClusterID)
				}
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.routeToRoom(msg.clusterID, msg.payload)

		case <-heartbeatTicker.C:
			h.broadcastHeartbeat()
		}
	}
}

// routeToRoom delivers a payload to all clients subscribed to the given clusterID room.
// Stale clients (full send buffers) are evicted immediately to prevent goroutine leaks.
func (h *Hub) routeToRoom(clusterID string, payload []byte) {
	h.mu.RLock()
	room, ok := h.rooms[clusterID]
	if !ok {
		h.mu.RUnlock()
		return
	}
	// Snapshot room clients under read lock to minimise lock hold time
	targets := make([]*Client, 0, len(room))
	for client := range room {
		targets = append(targets, client)
	}
	h.mu.RUnlock()

	// Deliver to each client outside the lock — non-blocking send to stay sub-200ms
	var stale []*Client
	for _, client := range targets {
		select {
		case client.send <- payload:
		default:
			// Client send buffer full — mark as stale
			stale = append(stale, client)
		}
	}

	// Evict stale clients under write lock
	if len(stale) > 0 {
		h.mu.Lock()
		for _, client := range stale {
			if room, ok := h.rooms[clusterID]; ok {
				if _, exists := room[client]; exists {
					delete(room, client)
					close(client.send)
					log.Printf("[WebSocket Hub] Evicted stale client %s from room '%s'", client.ID, clusterID)
				}
				if len(room) == 0 {
					delete(h.rooms, clusterID)
				}
			}
		}
		h.mu.Unlock()
	}
}

// BroadcastEvent serializes a structured event envelope and routes it to all clients
// subscribed to the given clusterID room. Target delivery latency: < 200ms.
// If a Redis EventPublisher is attached via SetPublisher, the envelope is also
// forwarded to peer streamer instances after local delivery.
func (h *Hub) BroadcastEvent(event string, clusterID string, data interface{}) {
	envelope := types.WSEventEnvelope{
		Event:     event,
		ClusterID: clusterID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Data:      data,
	}

	payload, err := json.Marshal(envelope)
	if err != nil {
		log.Printf("[WebSocket Hub] Failed to marshal event '%s' for cluster '%s': %v", event, clusterID, err)
		return
	}

	// Non-blocking local delivery — if the broadcast channel is saturated, log and drop
	// rather than blocking the Kubernetes Informer goroutine
	select {
	case h.broadcast <- roomedMessage{clusterID: clusterID, payload: payload}:
	default:
		log.Printf("[WebSocket Hub] Broadcast channel full — dropping event '%s' for cluster '%s'", event, clusterID)
	}

	// Fan-out to peer streamer instances via the attached publisher (e.g. Redis).
	// Done after the local channel send so we never block the Informer goroutine
	// waiting on a Redis round-trip.
	h.publisherMu.RLock()
	pub := h.publisher
	h.publisherMu.RUnlock()
	if pub != nil {
		pub.Publish(context.Background(), clusterID, envelope)
	}
}

// RouteRaw delivers a pre-serialized JSON payload directly to all clients in the
// given clusterID room. Used by the Redis adapter to inject events received from
// peer streamer instances without re-publishing back to Redis (which would create
// an infinite fan-out loop).
func (h *Hub) RouteRaw(clusterID string, payload []byte) {
	h.routeToRoom(clusterID, payload)
}

// ClientCount returns the total number of connected WebSocket clients across all rooms
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	total := 0
	for _, room := range h.rooms {
		total += len(room)
	}
	return total
}

// RoomSize returns the number of clients subscribed to a specific cluster room
func (h *Hub) RoomSize(clusterID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms[clusterID])
}

// RoomIDs returns the list of currently active cluster room IDs
func (h *Hub) RoomIDs() []string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	ids := make([]string, 0, len(h.rooms))
	for id := range h.rooms {
		ids = append(ids, id)
	}
	return ids
}

func (h *Hub) broadcastHeartbeat() {
	h.mu.RLock()
	clusterIDs := make([]string, 0, len(h.rooms))
	for id := range h.rooms {
		clusterIDs = append(clusterIDs, id)
	}
	h.mu.RUnlock()

	for _, clusterID := range clusterIDs {
		h.BroadcastEvent(types.EventHeartbeat, clusterID, map[string]interface{}{
			"activeClients": h.RoomSize(clusterID),
			"serverTime":    time.Now().UTC().Format(time.RFC3339),
		})
	}
}
