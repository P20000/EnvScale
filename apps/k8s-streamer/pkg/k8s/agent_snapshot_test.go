package k8s

import (
	"encoding/json"
	"testing"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

func TestAgentRegistry(t *testing.T) {
	registry := NewAgentRegistry()
	clusterID := "test-agent-cluster"

	if registry.IsConnected(clusterID) {
		t.Fatalf("expected cluster to not be connected initially")
	}

	snap := types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{
			{Name: "pod-1", Namespace: "default", Phase: "Running"},
		},
		Nodes: []types.NodeStatusDelta{
			{Name: "node-1", Status: "Ready"},
		},
		Services: []types.ServiceStatusDelta{
			{Name: "svc-1", Namespace: "default", Type: "ClusterIP"},
		},
	}

	registry.SetSnapshot(clusterID, snap)

	if !registry.IsConnected(clusterID) {
		t.Fatalf("expected cluster to be connected after SetSnapshot")
	}

	retrieved, ok := registry.GetSnapshot(clusterID)
	if !ok || retrieved == nil {
		t.Fatalf("failed to retrieve snapshot for %s", clusterID)
	}

	if len(retrieved.Pods) != 1 || retrieved.Pods[0].Name != "pod-1" {
		t.Fatalf("pod mismatch in snapshot: %+v", retrieved.Pods)
	}

	// Test Pod delta update
	updatedPod := types.PodStatusDelta{Name: "pod-1", Namespace: "default", Phase: "Pending"}
	rawPod, _ := json.Marshal(updatedPod)
	registry.ApplyDelta(clusterID, types.EventPodStatusChanged, rawPod)

	retrieved, _ = registry.GetSnapshot(clusterID)
	if retrieved.Pods[0].Phase != "Pending" {
		t.Fatalf("expected phase to be Pending, got %s", retrieved.Pods[0].Phase)
	}

	// Test Pod addition via delta
	newPod := types.PodStatusDelta{Name: "pod-2", Namespace: "default", Phase: "Running"}
	rawNewPod, _ := json.Marshal(newPod)
	registry.ApplyDelta(clusterID, types.EventPodStatusChanged, rawNewPod)

	retrieved, _ = registry.GetSnapshot(clusterID)
	if len(retrieved.Pods) != 2 {
		t.Fatalf("expected 2 pods, got %d", len(retrieved.Pods))
	}

	// Test Pod deletion via delta
	deletedPod := types.PodStatusDelta{Name: "pod-1", Namespace: "default"}
	rawDeleted, _ := json.Marshal(deletedPod)
	registry.ApplyDelta(clusterID, types.EventPodDeleted, rawDeleted)

	retrieved, _ = registry.GetSnapshot(clusterID)
	if len(retrieved.Pods) != 1 || retrieved.Pods[0].Name != "pod-2" {
		t.Fatalf("expected 1 pod remaining (pod-2), got %+v", retrieved.Pods)
	}

	// Test Disconnect
	registry.MarkDisconnected(clusterID)
	if registry.IsConnected(clusterID) {
		t.Fatalf("expected cluster to be marked disconnected")
	}
}
