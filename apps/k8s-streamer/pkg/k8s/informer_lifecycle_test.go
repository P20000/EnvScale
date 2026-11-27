package k8s

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestInformerManager_StartAsyncStopNoRaceNoDoubleClosePanic(t *testing.T) {
	hub := websocket.NewHub()
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p-1", Namespace: "default"}}
	client := fake.NewSimpleClientset(pod)

	for i := 0; i < 20; i++ {
		im := NewInformerManagerWithClientset(client, hub, "cluster-lifecycle-race")
		im.SetAllowedResources(map[string]bool{
			"core/v1/pods": true,
		})

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()
			im.GetSnapshotWithContext(ctx)
		}()
		go func() {
			defer wg.Done()
			im.StartAsync()
		}()
		wg.Wait()

		// Immediate double-Stop must never panic or resurrect running=true.
		im.Stop()
		im.Stop()
		im.StartAsync()

		if im.IsRunning() {
			t.Fatalf("iteration %d: InformerManager resurrected IsRunning() after Stop()", i)
		}
		if !im.IsStopped() {
			t.Fatalf("iteration %d: expected IsStopped() == true after Stop()", i)
		}
	}
}

func TestInformerManager_DynamicPermissionReconciliation(t *testing.T) {
	hub := websocket.NewHub()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "default"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "worker-1"},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}},
		},
	}
	client := fake.NewSimpleClientset(pod, node)

	im := NewInformerManagerWithClientset(client, hub, "cluster-reconcile")
	im.SetAllowedResources(map[string]bool{
		"core/v1/pods":     true,
		"core/v1/services": true,
		// core/v1/nodes initially denied
	})
	im.StartAsync()
	defer im.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	pods, nodes, svcs, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
	if len(pods) != 1 || pods[0].Name != "web-1" {
		t.Fatalf("expected 1 pod, got %+v", pods)
	}
	if svcs == nil || len(svcs) != 0 {
		t.Fatalf("expected permitted empty services slice ([] not nil), got %#v", svcs)
	}
	if nodes != nil {
		t.Fatalf("expected nil nodes slice when core/v1/nodes denied/unregistered, got %#v", nodes)
	}

	// Grant core/v1/nodes dynamically via ReconcileAllowedResources.
	activated := im.ReconcileAllowedResources(map[string]bool{
		"core/v1/pods":     true,
		"core/v1/services": true,
		"core/v1/nodes":    true,
	})
	if len(activated) != 1 || activated[0] != "core/v1/nodes" {
		t.Fatalf("expected core/v1/nodes to be activated, got %v", activated)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		_, nodes, _, _, _, _, _, _, _, _, _, _, _, _, _ = im.GetSnapshotWithContext(ctx)
		if len(nodes) == 1 && nodes[0].Name == "worker-1" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected dynamically activated node informer to sync worker-1, got %+v", nodes)
		}
		time.Sleep(15 * time.Millisecond)
	}

	// Simulate runtime 403 permission revocation for core/v1/nodes.
	im.ReconcileAllowedResources(map[string]bool{
		"core/v1/pods":     true,
		"core/v1/services": true,
	})
	_, nodesAfterRevoke, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
	if nodesAfterRevoke != nil {
		t.Fatalf("expected nil nodes slice after permission revocation, got %#v", nodesAfterRevoke)
	}
}

func TestInformerManager_MetricsContextCancellationAndGating(t *testing.T) {
	hub := websocket.NewHub()
	im := NewInformerManagerWithClientset(fake.NewSimpleClientset(), hub, "cluster-metrics-gate")
	im.SetMetricsAllowed(false)
	if im.IsMetricsAllowed() {
		t.Fatalf("expected metricsAllowed=false")
	}

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	if m := im.FetchPodMetricsMapWithContext(canceledCtx); len(m) != 0 {
		t.Fatalf("expected empty pod metrics map when canceled/disallowed, got %+v", m)
	}
	if m := im.FetchNodeMetricsMapWithContext(canceledCtx); len(m) != 0 {
		t.Fatalf("expected empty node metrics map when canceled/disallowed, got %+v", m)
	}

	// With zero permitted informers, WaitForSynced must NOT fabricate a LastSyncAt timestamp.
	emptyIM := NewInformerManagerWithClientset(fake.NewSimpleClientset(), hub, "cluster-zero-informers")
	emptyIM.SetAllowedResources(map[string]bool{})
	emptyIM.StartAsync()
	defer emptyIM.Stop()
	syncCtx, syncCancel := context.WithTimeout(context.Background(), time.Second)
	defer syncCancel()
	if !emptyIM.WaitForSynced(syncCtx) {
		t.Fatalf("expected WaitForSynced to return true cleanly when zero informers started")
	}
	if !emptyIM.LastSyncAt().IsZero() {
		t.Fatalf("expected zero/unknown LastSyncAt when zero informers synchronized, got %v", emptyIM.LastSyncAt())
	}
}

func TestAgentRegistry_ConcurrentGetSnapshotAndApplyDeltaRace(t *testing.T) {
	reg := NewAgentRegistry()
	const cid = "agent-race-cluster"
	reg.RegisterSession(cid, "sess-1")
	reg.SetSnapshotForSession(cid, "sess-1", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{
			{Name: "pod-0", Namespace: "default", Phase: "Running"},
			{Name: "pod-1", Namespace: "default", Phase: "Running"},
		},
		Deployments: []types.DeploymentStatusDelta{
			{Name: "dep-0", Namespace: "default", Replicas: 1},
		},
	})

	stopCh := make(chan struct{})
	var wg sync.WaitGroup

	// Readers + JSON marshalers
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stopCh:
					return
				default:
					snap, ok := reg.GetSnapshot(cid)
					if ok && snap != nil {
						_, _ = json.Marshal(snap)
					}
				}
			}
		}()
	}

	// Writers mutating Pods & Deployments via ApplyDeltaForSession
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			mutatePod, _ := json.Marshal(types.PodStatusDelta{
				Name:         "pod-0",
				Namespace:    "default",
				Phase:        "Pending",
				RestartCount: int32(i),
			})
			reg.ApplyDeltaForSession(cid, "sess-1", types.EventPodStatusChanged, mutatePod)

			delPod, _ := json.Marshal(types.PodStatusDelta{Name: "pod-1", Namespace: "default"})
			reg.ApplyDeltaForSession(cid, "sess-1", types.EventPodDeleted, delPod)

			readdPod, _ := json.Marshal(types.PodStatusDelta{Name: "pod-1", Namespace: "default", Phase: "Running"})
			reg.ApplyDeltaForSession(cid, "sess-1", types.EventPodStatusChanged, readdPod)

			depDelta, _ := json.Marshal(types.DeploymentStatusDelta{Name: "dep-0", Namespace: "default", Replicas: int32(i % 5)})
			reg.ApplyDeltaForSession(cid, "sess-1", types.EventDeploymentMutated, depDelta)
		}
	}()

	time.Sleep(100 * time.Millisecond)
	close(stopCh)
	wg.Wait()
}

func TestClusterManager_ProductionProberHookAndAgentUnregister(t *testing.T) {
	hub := websocket.NewHub()
	cm := NewClusterManager(hub)

	var proberCalled atomic.Bool
	cm.SetResourceProber(func(ctx context.Context, clusterID string, clientset kubernetes.Interface, watchSecrets bool) (map[string]bool, bool) {
		proberCalled.Store(true)
		return map[string]bool{
			"core/v1/pods": true,
		}, false
	})

	client := fake.NewSimpleClientset(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "d1", Namespace: "default"}})
	im := cm.RegisterWithClientsetProbed("cluster-probed", client)
	defer im.Stop()

	if !proberCalled.Load() {
		t.Fatalf("expected ResourceProber to be invoked before starting informers")
	}
	cache.WaitForCacheSync(im.stopCh, im.syncedByKey["core/v1/pods"])

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, nodes, _, deps, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
	if nodes != nil || deps != nil {
		t.Fatalf("expected unpermitted nodes and deployments informers not to be registered, got nodes=%#v deps=%#v", nodes, deps)
	}

	// Register and unregister an Agent cluster via ClusterManager.
	cm.AgentRegistry().SetSnapshot("agent-unreg", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{{Name: "p1", Namespace: "default"}},
	})
	if !cm.AgentRegistry().HasCluster("agent-unreg") {
		t.Fatalf("expected agent-unreg to be registered")
	}
	if err := cm.UnregisterCluster("agent-unreg"); err != nil {
		t.Fatalf("expected UnregisterCluster on agent cluster to succeed, got %v", err)
	}
	if cm.AgentRegistry().HasCluster("agent-unreg") {
		t.Fatalf("expected agent-unreg to be removed after UnregisterCluster")
	}
}

func TestInformerManager_RuntimeRevocationStopsWatchAndDiscardsCache(t *testing.T) {
	hub := websocket.NewHub()
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p-1", Namespace: "default"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}}
	nodeOld := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-old"},
		Status:     corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}},
	}
	client := fake.NewSimpleClientset(pod, nodeOld)

	var nodeListWatchCalls atomic.Int64
	client.PrependReactor("list", "nodes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		nodeListWatchCalls.Add(1)
		return false, nil, nil
	})
	client.PrependReactor("watch", "nodes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		nodeListWatchCalls.Add(1)
		return false, nil, nil
	})

	im := NewInformerManagerWithClientset(client, hub, "cluster-revoke")
	im.SetAllowedResources(map[string]bool{
		"core/v1/pods":  true,
		"core/v1/nodes": true,
	})
	im.StartAsync()
	defer im.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Confirm node-old is cached and returned initially.
	deadline := time.Now().Add(2 * time.Second)
	for {
		_, nodes, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
		if len(nodes) == 1 && nodes[0].Name == "node-old" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected initial node-old sync, got %+v", nodes)
		}
		time.Sleep(15 * time.Millisecond)
	}

	// Revoke nodes permission: must stop old watch/factory and discard cached node-old immediately.
	im.ReconcileAllowedResources(map[string]bool{
		"core/v1/pods":  true,
		"core/v1/nodes": false,
	})
	time.Sleep(40 * time.Millisecond)
	countAfterRevoke := nodeListWatchCalls.Load()

	// Wait and verify zero additional list/watch calls hit nodes while revoked.
	time.Sleep(80 * time.Millisecond)
	if nodeListWatchCalls.Load() != countAfterRevoke {
		t.Fatalf("expected revoked nodes informer to stop watching/listing (before=%d, after=%d)", countAfterRevoke, nodeListWatchCalls.Load())
	}

	podsRevoked, nodesRevoked, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
	if len(podsRevoked) != 1 || podsRevoked[0].Name != "p-1" {
		t.Fatalf("expected pods to keep syncing after nodes revocation, got %+v", podsRevoked)
	}
	if nodesRevoked != nil {
		t.Fatalf("expected revoked nodes cache discarded (nil snapshot slice), got %#v", nodesRevoked)
	}

	// Replace node-old with node-fresh in backend clientset and restore permission:
	// fresh informer must sync node-fresh (not stale node-old).
	_ = client.CoreV1().Nodes().Delete(context.Background(), "node-old", metav1.DeleteOptions{})
	_, _ = client.CoreV1().Nodes().Create(context.Background(), &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-fresh"},
		Status:     corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}},
	}, metav1.CreateOptions{})

	im.ReconcileAllowedResources(map[string]bool{
		"core/v1/pods":  true,
		"core/v1/nodes": true,
	})

	deadline = time.Now().Add(2 * time.Second)
	for {
		_, nodesRestored, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
		if len(nodesRestored) == 1 && nodesRestored[0].Name == "node-fresh" {
			break
		}
		if len(nodesRestored) == 1 && nodesRestored[0].Name == "node-old" {
			t.Fatalf("stale node-old exposed after fresh informer restoration")
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for fresh node-fresh sync, got %+v", nodesRestored)
		}
		time.Sleep(15 * time.Millisecond)
	}
}

