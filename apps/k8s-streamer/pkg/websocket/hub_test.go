package websocket

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// makeTestClient creates a bare Client with a buffered send channel (no real WebSocket conn needed)
func makeTestClient(id string, clusterID string, hub *Hub) *Client {
	return &Client{
		ID:        id,
		ClusterID: clusterID,
		Hub:       hub,
		Conn:      nil,
		send:      make(chan []byte, 256),
	}
}

func TestRoomBasedRouting_OnlyDeliverstToCorrectRoom(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(20 * time.Millisecond) // let hub goroutine start

	clientAlpha := makeTestClient("alpha-client-1", "cluster-alpha", hub)
	clientBeta := makeTestClient("beta-client-1", "cluster-beta", hub)

	hub.Register <- clientAlpha
	hub.Register <- clientBeta
	time.Sleep(20 * time.Millisecond)

	// Broadcast an event only to cluster-alpha
	hub.BroadcastEvent(types.EventPodStatusChanged, "cluster-alpha", types.PodStatusDelta{
		Name:      "auth-pod-1",
		Namespace: "default",
		Phase:     "Running",
	})
	time.Sleep(50 * time.Millisecond)

	// cluster-alpha client MUST receive the event
	select {
	case msg := <-clientAlpha.send:
		var envelope types.WSEventEnvelope
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("Failed to unmarshal event: %v", err)
		}
		if envelope.Event != types.EventPodStatusChanged {
			t.Errorf("Expected event '%s', got '%s'", types.EventPodStatusChanged, envelope.Event)
		}
		if envelope.ClusterID != "cluster-alpha" {
			t.Errorf("Expected clusterID 'cluster-alpha', got '%s'", envelope.ClusterID)
		}
	case <-time.After(200 * time.Millisecond):
		t.Error("cluster-alpha client did not receive event within 200ms")
	}

	// cluster-beta client MUST NOT receive the event
	select {
	case msg := <-clientBeta.send:
		t.Errorf("cluster-beta client incorrectly received event meant for cluster-alpha: %s", msg)
	case <-time.After(100 * time.Millisecond):
		// Correct — nothing received
	}
}

func TestRoomBasedRouting_AllClientsInRoomReceiveEvent(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(20 * time.Millisecond)

	c1 := makeTestClient("client-1", "cluster-x", hub)
	c2 := makeTestClient("client-2", "cluster-x", hub)
	c3 := makeTestClient("client-3", "cluster-x", hub)

	hub.Register <- c1
	hub.Register <- c2
	hub.Register <- c3
	time.Sleep(30 * time.Millisecond)

	hub.BroadcastEvent(types.EventNodeMutated, "cluster-x", types.NodeStatusDelta{
		Name:   "node-worker-1",
		Status: "Ready",
	})
	time.Sleep(50 * time.Millisecond)

	for _, client := range []*Client{c1, c2, c3} {
		select {
		case msg := <-client.send:
			var envelope types.WSEventEnvelope
			if err := json.Unmarshal(msg, &envelope); err != nil {
				t.Errorf("Client %s: failed to unmarshal: %v", client.ID, err)
			}
		case <-time.After(200 * time.Millisecond):
			t.Errorf("Client %s did not receive event within 200ms", client.ID)
		}
	}
}

func TestClientCount_AcrossRooms(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(20 * time.Millisecond)

	hub.Register <- makeTestClient("c1", "room-a", hub)
	hub.Register <- makeTestClient("c2", "room-a", hub)
	hub.Register <- makeTestClient("c3", "room-b", hub)
	time.Sleep(30 * time.Millisecond)

	if hub.ClientCount() != 3 {
		t.Errorf("Expected 3 total clients, got %d", hub.ClientCount())
	}
	if hub.RoomSize("room-a") != 2 {
		t.Errorf("Expected 2 clients in room-a, got %d", hub.RoomSize("room-a"))
	}
	if hub.RoomSize("room-b") != 1 {
		t.Errorf("Expected 1 client in room-b, got %d", hub.RoomSize("room-b"))
	}
}

func TestEmptyRoomPruning_AfterUnregister(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(20 * time.Millisecond)

	client := makeTestClient("solo-client", "cluster-solo", hub)
	hub.Register <- client
	time.Sleep(20 * time.Millisecond)

	if hub.RoomSize("cluster-solo") != 1 {
		t.Fatalf("Expected 1 client in room before unregister")
	}

	hub.Unregister <- client
	time.Sleep(30 * time.Millisecond)

	rooms := hub.RoomIDs()
	for _, id := range rooms {
		if id == "cluster-solo" {
			t.Error("Expected empty room 'cluster-solo' to be pruned after last client unregistered")
		}
	}
}

func BenchmarkBroadcastEvent_Sub200ms(b *testing.B) {
	hub := NewHub()
	go hub.Run()
	time.Sleep(20 * time.Millisecond)

	// Add 10 concurrent clients to the room
	for i := 0; i < 10; i++ {
		c := makeTestClient("bench-client", "bench-cluster", hub)
		hub.Register <- c
	}
	time.Sleep(50 * time.Millisecond)

	delta := types.PodStatusDelta{
		Name:      "bench-pod",
		Namespace: "default",
		Phase:     "Running",
	}

	for b.Loop() {
		hub.BroadcastEvent(types.EventPodStatusChanged, "bench-cluster", delta)
	}
}
