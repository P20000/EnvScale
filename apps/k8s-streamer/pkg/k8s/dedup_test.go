package k8s

import (
	"testing"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

func TestDedupCache_SuppressesUnchangedDeltas(t *testing.T) {
	cache := NewDedupCache()
	key := "Pod/default/nginx-pod"

	delta1 := types.PodStatusDelta{
		Name:         "nginx-pod",
		Namespace:    "default",
		Phase:        "Running",
		RestartCount: 0,
	}

	// First time seeing this delta — should emit
	if !cache.ShouldEmit(key, delta1) {
		t.Fatalf("Expected ShouldEmit to return true on first call")
	}

	// Second time seeing identical delta — should suppress
	if cache.ShouldEmit(key, delta1) {
		t.Fatalf("Expected ShouldEmit to return false for identical delta")
	}

	// Delta changed (e.g. restart count increased) — should emit again
	delta2 := delta1
	delta2.RestartCount = 1

	if !cache.ShouldEmit(key, delta2) {
		t.Fatalf("Expected ShouldEmit to return true when delta changes")
	}

	// Submitting delta2 again — should suppress
	if cache.ShouldEmit(key, delta2) {
		t.Fatalf("Expected ShouldEmit to return false for identical changed delta")
	}
}

func TestDedupCache_Remove(t *testing.T) {
	cache := NewDedupCache()
	key := "Pod/default/pod-to-delete"

	delta := types.PodStatusDelta{Name: "pod-to-delete", Namespace: "default", Phase: "Running"}

	cache.ShouldEmit(key, delta)
	if cache.Size() != 1 {
		t.Fatalf("Expected cache size 1, got %d", cache.Size())
	}

	cache.Remove(key)
	if cache.Size() != 0 {
		t.Fatalf("Expected cache size 0 after Remove, got %d", cache.Size())
	}

	// After removal, should emit again
	if !cache.ShouldEmit(key, delta) {
		t.Fatalf("Expected ShouldEmit to return true after key was removed")
	}
}

func TestDedupCache_IndependentKeys(t *testing.T) {
	cache := NewDedupCache()

	key1 := "Pod/ns1/pod1"
	key2 := "Pod/ns2/pod2"

	delta1 := types.PodStatusDelta{Name: "pod1", Namespace: "ns1", Phase: "Running"}
	delta2 := types.PodStatusDelta{Name: "pod2", Namespace: "ns2", Phase: "Running"}

	if !cache.ShouldEmit(key1, delta1) {
		t.Fatalf("Expected key1 to emit")
	}
	if !cache.ShouldEmit(key2, delta2) {
		t.Fatalf("Expected key2 to emit independently")
	}

	if cache.Size() != 2 {
		t.Fatalf("Expected cache size 2, got %d", cache.Size())
	}
}
