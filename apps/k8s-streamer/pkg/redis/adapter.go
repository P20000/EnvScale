// Package redis provides a Redis Pub/Sub adapter that bridges multiple k8s-streamer
// instances running in parallel (e.g., horizontally scaled Kubernetes pods).
//
// Without Redis, each k8s-streamer process has its own in-memory WebSocket Hub.
// Kubernetes Informer events are only delivered to clients connected to the *same*
// instance that received the event. When scaled to N replicas, clients on replica-2
// would miss events from replica-1's Informer pipeline.
//
// The adapter solves this by:
//   1. Publishing every BroadcastEvent call to a shared Redis Pub/Sub channel
//      `envscale:events:{clusterID}`.
//   2. Subscribing to all `envscale:events:*` channels and forwarding received
//      messages into the local Hub's routeToRoom — ensuring every instance
//      sees every event regardless of which replica generated it.
//
// Deduplication: to prevent an instance from double-delivering its own events
// (once from the local Hub and once from Redis), each message is tagged with a
// unique `instanceID`. Messages originating from *this* instance are silently
// dropped on the subscriber side.
package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// redisChannelPrefix is the Redis Pub/Sub channel prefix used for all EnvScale event messages.
// Each cluster gets its own sub-channel: envscale:events:{clusterID}
const redisChannelPrefix = "envscale:events:"

// redisMessage is the wire format published to Redis. It wraps the standard
// WSEventEnvelope and adds an instanceID to enable self-deduplication.
type redisMessage struct {
	InstanceID string                `json:"instanceId"`
	Envelope   types.WSEventEnvelope `json:"envelope"`
}

// HubPublisher is the interface the Redis adapter uses to push received remote
// events into the local WebSocket hub without going through the Hub's BroadcastEvent
// (which would re-publish to Redis, creating an infinite loop).
type HubPublisher interface {
	// RouteRaw delivers a pre-serialized JSON payload directly to all clients in a room.
	// This bypasses BroadcastEvent serialization and Redis re-publication.
	RouteRaw(clusterID string, payload []byte)
}

// Adapter bridges the local WebSocket Hub with a Redis Pub/Sub channel cluster
// to enable horizontal scaling across multiple k8s-streamer instances.
type Adapter struct {
	client     *goredis.Client
	instanceID string // unique ID for this process instance — used for dedup
	hub        HubPublisher
	pubsub     *goredis.PubSub
	mu         sync.Mutex
	running    bool
	stopCh     chan struct{}
}

// Config holds configuration values for connecting to Redis.
type Config struct {
	// URL is the Redis connection URL (e.g. "redis://localhost:6379" or
	// "redis://:password@redis-host:6379/0"). Required.
	URL string

	// InstanceID uniquely identifies this streamer process. Used to prevent
	// self-echo of published messages. Defaults to a timestamp-based ID if empty.
	InstanceID string
}

// NewAdapter creates a new Redis Pub/Sub adapter and verifies the connection
// with a PING. Returns an error if Redis is unreachable — the caller should
// treat this as optional and fall back to single-instance mode gracefully.
func NewAdapter(cfg Config, hub HubPublisher) (*Adapter, error) {
	if cfg.InstanceID == "" {
		cfg.InstanceID = fmt.Sprintf("streamer-%d", time.Now().UnixNano())
	}

	opts, err := goredis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid Redis URL %q: %w", cfg.URL, err)
	}

	client := goredis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("Redis PING failed — is Redis reachable at %q? error: %w", cfg.URL, err)
	}

	log.Printf("[Redis Adapter] Connected to Redis at %s (instanceId: %s)", cfg.URL, cfg.InstanceID)

	return &Adapter{
		client:     client,
		instanceID: cfg.InstanceID,
		hub:        hub,
		stopCh:     make(chan struct{}),
	}, nil
}

// Start launches the Redis subscription goroutine. It subscribes to the
// pattern `envscale:events:*` and forwards incoming remote events to the
// local Hub. This is non-blocking — the subscription loop runs in a background goroutine.
func (a *Adapter) Start(ctx context.Context) {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return
	}
	a.running = true
	a.pubsub = a.client.PSubscribe(ctx, redisChannelPrefix+"*")
	a.mu.Unlock()

	go a.subscribeLoop(ctx)
	log.Printf("[Redis Adapter] Subscribed to pattern '%s*' — listening for remote events", redisChannelPrefix)
}

// Stop cancels the Redis subscription and closes the client connection.
func (a *Adapter) Stop() {
	a.mu.Lock()
	defer a.mu.Unlock()

	if !a.running {
		return
	}
	a.running = false
	close(a.stopCh)

	if a.pubsub != nil {
		if err := a.pubsub.Close(); err != nil {
			log.Printf("[Redis Adapter] Error closing PubSub: %v", err)
		}
	}
	if err := a.client.Close(); err != nil {
		log.Printf("[Redis Adapter] Error closing Redis client: %v", err)
	}
	log.Println("[Redis Adapter] Stopped and connection closed")
}

// Publish serializes the event envelope and publishes it to the Redis
// channel for the given clusterID. Called by the Hub wrapper (see BroadcastAndPublish)
// after a local Hub broadcast so remote instances receive the event too.
func (a *Adapter) Publish(ctx context.Context, clusterID string, envelope types.WSEventEnvelope) {
	msg := redisMessage{
		InstanceID: a.instanceID,
		Envelope:   envelope,
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Redis Adapter] Failed to marshal event '%s' for cluster '%s': %v",
			envelope.Event, clusterID, err)
		return
	}

	channel := redisChannelPrefix + clusterID
	if err := a.client.Publish(ctx, channel, payload).Err(); err != nil {
		log.Printf("[Redis Adapter] Failed to publish event '%s' to channel '%s': %v",
			envelope.Event, channel, err)
	}
}

// subscribeLoop reads messages from the Redis PSubscribe channel and routes
// them to the local Hub. It runs until the context is cancelled or Stop() is called.
func (a *Adapter) subscribeLoop(ctx context.Context) {
	ch := a.pubsub.Channel()

	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stopCh:
			return
		case msg, ok := <-ch:
			if !ok {
				// Channel closed — PubSub was stopped
				return
			}
			a.handleMessage(msg)
		}
	}
}

// handleMessage deserializes a raw Redis Pub/Sub message and routes the
// contained event payload to the local Hub, skipping self-originated messages.
func (a *Adapter) handleMessage(msg *goredis.Message) {
	var wrapper redisMessage
	if err := json.Unmarshal([]byte(msg.Payload), &wrapper); err != nil {
		log.Printf("[Redis Adapter] Failed to unmarshal message on channel '%s': %v", msg.Channel, err)
		return
	}

	// Self-deduplication: skip messages we published ourselves to prevent
	// double-delivery (this instance already delivered it locally via Hub).
	if wrapper.InstanceID == a.instanceID {
		return
	}

	// Re-serialize just the WSEventEnvelope to pass to RouteRaw.
	// We cannot call hub.BroadcastEvent here — that would re-publish to Redis, causing an infinite loop.
	payload, err := json.Marshal(wrapper.Envelope)
	if err != nil {
		log.Printf("[Redis Adapter] Failed to re-serialize envelope from instance '%s': %v",
			wrapper.InstanceID, err)
		return
	}

	a.hub.RouteRaw(wrapper.Envelope.ClusterID, payload)
}

// IsRunning returns whether the adapter subscription loop is currently active.
func (a *Adapter) IsRunning() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.running
}
