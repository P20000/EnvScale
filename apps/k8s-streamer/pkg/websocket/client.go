package websocket

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 512 * 1024 // 512 KB
)

// IsOriginAllowed checks if the incoming HTTP request origin is permitted by CORS configuration.
func IsOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true // Non-browser clients, cURL, and native apps
	}

	allowedEnv := os.Getenv("CORS_ORIGIN")
	if allowedEnv == "" {
		allowedEnv = os.Getenv("ALLOWED_ORIGINS")
	}

	if allowedEnv == "*" {
		return true
	}

	var allowedList []string
	if allowedEnv != "" {
		for _, o := range strings.Split(allowedEnv, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				allowedList = append(allowedList, trimmed)
			}
		}
	} else {
		allowedList = []string{
			"http://localhost:5173",
			"http://localhost:3000",
			"http://127.0.0.1:5173",
			"http://127.0.0.1:3000",
		}
	}

	for _, allowed := range allowedList {
		if origin == allowed {
			return true
		}
	}
	return false
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     IsOriginAllowed,
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	// ID is the unique identifier for this client connection
	ID string

	// ClusterID is the Kubernetes cluster room this client subscribes to
	ClusterID string

	Hub  *Hub
	Conn *websocket.Conn

	// Buffered channel of outbound messages.
	send chan []byte

	// Protection against race condition panics on closed channel sends
	mu     sync.Mutex
	closed bool
}

// NewClient initializes a Client instance subscribed to a specific cluster room
func NewClient(id string, clusterID string, hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		ID:        id,
		ClusterID: clusterID,
		Hub:       hub,
		Conn:      conn,
		send:      make(chan []byte, 256),
	}
}

// Send attempts to enqueue a payload to the client's send buffer.
// Returns false if the client is closed or buffer full, preventing closed-channel panics.
func (c *Client) Send(payload []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return false
	}
	select {
	case c.send <- payload:
		return true
	default:
		return false
	}
}

// Close safely shuts down the outbound buffer without multiple close panic risks.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.send)
	}
}

// ReadPump pumps messages from the websocket connection to the hub.
func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, _, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket Client %s] Read error: %v", c.ID, err)
			}
			break
		}
	}
}

// WritePump pumps messages from the hub to the websocket connection.
// When multiple events queue up (common in large clusters with 50+ pods),
// it coalesces them into a single JSON array frame rather than sending
// individual messages — reducing WebSocket frame overhead by up to 60%.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Check how many additional messages are queued
			queued := len(c.send)

			if queued == 0 {
				// Single message — send as-is (no batching overhead for low-load clusters)
				w, err := c.Conn.NextWriter(websocket.TextMessage)
				if err != nil {
					return
				}
				w.Write(message)
				if err := w.Close(); err != nil {
					return
				}
			} else {
				// Multiple queued messages — batch into a JSON array frame:
				// [<msg1>,<msg2>,...,<msgN>]
				// This dramatically reduces per-frame TCP/TLS overhead for high-throughput clusters
				w, err := c.Conn.NextWriter(websocket.TextMessage)
				if err != nil {
					return
				}

				w.Write([]byte{'['})
				w.Write(message)
				for i := 0; i < queued; i++ {
					select {
					case nextMsg, ok := <-c.send:
						if ok && len(nextMsg) > 0 {
							w.Write([]byte{','})
							w.Write(nextMsg)
						}
					default:
					}
				}
				w.Write([]byte{']'})

				if err := w.Close(); err != nil {
					return
				}
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeWs handles websocket requests from the peer.
// Query params:
//   - clientId  (optional) — unique client identifier; auto-generated if absent
//   - clusterId (required) — Kubernetes cluster room to subscribe to
func ServeWs(hub *Hub, id string, w http.ResponseWriter, r *http.Request) {
	claims, err := AuthenticateHandshake(r)
	if err != nil {
		log.Printf("[WebSocket Auth] Rejected unauthenticated connection from %s: %v", r.RemoteAddr, err)
		http.Error(w, fmt.Sprintf("Unauthorized: %v", err), http.StatusUnauthorized)
		return
	}

	clusterID := r.URL.Query().Get("clusterId")
	if clusterID == "" {
		http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
		return
	}

	if err := CheckClusterAuthorization(claims, clusterID); err != nil {
		log.Printf("[WebSocket Auth] Rejected unauthorized connection for cluster %s from %s: %v", clusterID, r.RemoteAddr, err)
		http.Error(w, fmt.Sprintf("Forbidden: %v", err), http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket Upgrade] Error upgrading connection: %v", err)
		return
	}

	client := NewClient(id, clusterID, hub, conn)
	client.Hub.Register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.WritePump()
	go client.ReadPump()
}

