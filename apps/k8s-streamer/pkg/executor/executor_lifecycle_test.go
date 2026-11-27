package executor

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestDirectExecutor_SingleflightAndCanceledContextDoesNotPoisonCache(t *testing.T) {
	client := fake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p1", Namespace: "default"}})
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(true)

	var ssarCalls atomic.Int64
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		ssarCalls.Add(1)
		time.Sleep(15 * time.Millisecond)
		sar := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview).DeepCopy()
		sar.Status.Allowed = true
		return true, sar, nil
	})

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	im := cm.RegisterWithClientset("cluster-sf", client)
	defer im.Stop()

	factory := NewClusterExecutorFactory(cm)

	// 1. Pre-canceled caller context must not probe or poison cache.
	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	canceledCaps, err := factory.Capabilities(canceledCtx, "cluster-sf")
	if err != nil {
		t.Fatalf("unexpected factory error on canceled ctx: %v", err)
	}
	if canceledCaps.Capabilities[CapTopology].State != CapTemporarilyUnavailable {
		t.Fatalf("expected ephemeral temporarily_unavailable on canceled ctx, got %+v", canceledCaps.Capabilities[CapTopology])
	}
	if ssarCalls.Load() != 0 {
		t.Fatalf("expected pre-canceled context to make 0 SSAR calls, made %d", ssarCalls.Load())
	}

	// 2. Concurrent cold-cache callers deduplicate into a single probe batch.
	const callers = 20
	var wg sync.WaitGroup
	results := make([]ClusterCapabilities, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			caps, err := factory.Capabilities(context.Background(), "cluster-sf")
			if err != nil {
				t.Errorf("caller %d failed: %v", idx, err)
				return
			}
			results[idx] = caps
		}(i)
	}
	wg.Wait()

	for i, c := range results {
		if c.ConnectionState != StateConnected {
			t.Fatalf("caller %d expected StateConnected, got %q", i, c.ConnectionState)
		}
	}
	if calls := ssarCalls.Load(); calls > 80 {
		t.Fatalf("expected singleflight deduplication (<=80 SSAR calls across 20 callers), got %d", calls)
	}
}

func TestDirectExecutor_RateLimit429ShortCircuitsAndOptionalCRDNotDegraded(t *testing.T) {
	// Healthy cluster WITHOUT snapshot.storage.k8s.io must still report StateConnected.
	healthyClient := fake.NewSimpleClientset()
	healthyClient.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(true)
	attachSSARReactor(healthyClient, map[string]bool{})

	healthyCaps := ProbeDirectCapabilities(context.Background(), "cluster-healthy", healthyClient, false)
	if healthyCaps.ConnectionState != StateConnected {
		t.Fatalf("expected StateConnected without optional snapshot CRDs, got %q", healthyCaps.ConnectionState)
	}
	if healthyCaps.Resources["snapshot.storage.k8s.io/v1/volumesnapshots"].State != CapClusterUnavailable {
		t.Fatalf("expected optional volumesnapshots=cluster_unavailable, got %+v", healthyCaps.Resources["snapshot.storage.k8s.io/v1/volumesnapshots"])
	}

	// Throttled 429 API server must short-circuit SSAR storm and classify as temporarily_unavailable (never not_implemented).
	throttledClient := fake.NewSimpleClientset()
	throttledClient.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(true)
	var throttledCount atomic.Int64
	throttledClient.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		throttledCount.Add(1)
		return true, nil, apierrors.NewTooManyRequests("apiserver throttled", 5)
	})

	throttledCaps := ProbeDirectCapabilities(context.Background(), "cluster-429", throttledClient, false)
	if throttledCaps.Capabilities[CapTopology].State != CapTemporarilyUnavailable {
		t.Fatalf("expected CapTopology=temporarily_unavailable on 429, got %+v", throttledCaps.Capabilities[CapTopology])
	}
	if calls := throttledCount.Load(); calls > 10 {
		t.Fatalf("expected 429 short-circuit (<=10 SSAR calls), got %d", calls)
	}
}

func TestDirectExecutor_DynamicPermissionRecoveryAndRevocation(t *testing.T) {
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "app-1", Namespace: "default"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}}
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status:     corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}},
	}

	client := fake.NewSimpleClientset(pod, node)
	client.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(true)

	var nodesAllowed atomic.Bool
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		sar := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview).DeepCopy()
		ra := sar.Spec.ResourceAttributes
		allowed := true
		if ra != nil && ra.Group == "" && ra.Resource == "nodes" && !nodesAllowed.Load() {
			allowed = false
		}
		sar.Status.Allowed = allowed
		return true, sar, nil
	})
	client.PrependReactor("list", "nodes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		if !nodesAllowed.Load() {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "", errors.New("forbidden"))
		}
		return false, nil, nil
	})
	client.PrependReactor("watch", "nodes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		if !nodesAllowed.Load() {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "nodes"}, "", errors.New("forbidden"))
		}
		return false, nil, nil
	})

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	cm.SetResourceProber(func(ctx context.Context, clusterID string, cs kubernetes.Interface, watchSecrets bool) (map[string]bool, bool) {
		caps := ProbeDirectCapabilities(ctx, clusterID, cs, watchSecrets)
		return AllowedResourceMap(caps), caps.Capabilities[CapMetrics].State == CapSupportedWorking
	})

	im := cm.RegisterWithClientsetProbed("cluster-dyn", client)
	defer im.Stop()

	factory := NewClusterExecutorFactory(cm)
	ctx := context.Background()

	// 1. Initially nodes are denied; snapshot succeeds quickly with Nodes == nil (unavailable) and Topology supported.
	start := time.Now()
	snap1, err := factory.GetSnapshot(ctx, "cluster-dyn")
	if err != nil {
		t.Fatalf("expected degraded GetSnapshot to succeed, got %v", err)
	}
	if time.Since(start) > 1*time.Second {
		t.Fatalf("expected non-blocking snapshot under initial 403, took %v", time.Since(start))
	}
	if snap1.Capabilities.Resources["core/v1/nodes"].State != CapPermissionDenied {
		t.Fatalf("expected initial nodes=permission_denied, got %+v", snap1.Capabilities.Resources["core/v1/nodes"])
	}
	if snap1.Nodes != nil {
		t.Fatalf("expected snap1.Nodes == nil when permission_denied, got %#v", snap1.Nodes)
	}
	if len(snap1.Pods) != 1 || snap1.Pods[0].Name != "app-1" {
		t.Fatalf("expected pod app-1, got %+v", snap1.Pods)
	}

	// 2. Grant RBAC permissions for nodes and explicitly reconcile via CapabilitiesWithRefresh(..., true).
	nodesAllowed.Store(true)
	caps2, err := factory.CapabilitiesWithRefresh(ctx, "cluster-dyn", true)
	if err != nil {
		t.Fatalf("refresh failed: %v", err)
	}
	if caps2.Resources["core/v1/nodes"].State != CapSupportedWorking || caps2.ConnectionState != StateConnected {
		t.Fatalf("expected nodes recovery to supported_working/connected, got state=%q node=%+v", caps2.ConnectionState, caps2.Resources["core/v1/nodes"])
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		snap2, err := factory.GetSnapshot(ctx, "cluster-dyn")
		if err != nil {
			t.Fatalf("GetSnapshot after recovery failed: %v", err)
		}
		if len(snap2.Nodes) == 1 && snap2.Nodes[0].Name == "node-1" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected recovered snapshot to include node-1, got %+v", snap2.Nodes)
		}
		time.Sleep(20 * time.Millisecond)
	}

	// 3. Revoke permissions at runtime and refresh -> capability reverts to permission_denied and Nodes reverts to nil.
	nodesAllowed.Store(false)
	caps3, err := factory.CapabilitiesWithRefresh(ctx, "cluster-dyn", true)
	if err != nil {
		t.Fatalf("revocation refresh failed: %v", err)
	}
	if caps3.Resources["core/v1/nodes"].State != CapPermissionDenied {
		t.Fatalf("expected nodes=permission_denied after revocation, got %+v", caps3.Resources["core/v1/nodes"])
	}
	snap3, err := factory.GetSnapshot(ctx, "cluster-dyn")
	if err != nil {
		t.Fatalf("GetSnapshot after revocation failed: %v", err)
	}
	if snap3.Nodes != nil {
		t.Fatalf("expected snap3.Nodes == nil after runtime revocation, got %#v", snap3.Nodes)
	}
}

func TestClusterExecutorFactory_GenerationSafeInvalidationAndEvictRace(t *testing.T) {
	const cid = "cluster-gen"
	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)

	probeStarted := make(chan struct{})
	releaseOldProbe := make(chan struct{})
	var notifyOnce sync.Once

	slowClient1 := fake.NewSimpleClientset()
	slowClient1.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(false) // degraded
	slowClient1.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		notifyOnce.Do(func() { close(probeStarted) })
		<-releaseOldProbe
		sar := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview).DeepCopy()
		sar.Status.Allowed = true
		return true, sar, nil
	})

	fastClient2 := fake.NewSimpleClientset()
	fastClient2.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(true) // connected
	attachSSARReactor(fastClient2, map[string]bool{})

	im1 := cm.RegisterWithClientset(cid, slowClient1)
	defer im1.Stop()

	factory := NewClusterExecutorFactory(cm)
	exec1, err := factory.GetExecutor(cid)
	if err != nil {
		t.Fatalf("unexpected GetExecutor error: %v", err)
	}

	var oldWg sync.WaitGroup
	var oldCaps ClusterCapabilities
	oldWg.Add(1)
	go func() {
		defer oldWg.Done()
		oldCaps = exec1.Capabilities(context.Background())
	}()

	<-probeStarted

	// Evict and re-register generation 2 while generation 1's probe is paused mid-flight.
	_ = cm.UnregisterCluster(cid)
	factory.Evict(cid)
	im2 := cm.RegisterWithClientset(cid, fastClient2)
	defer im2.Stop()

	caps2, err := factory.Capabilities(context.Background(), cid)
	if err != nil {
		t.Fatalf("gen2 Capabilities failed: %v", err)
	}
	if caps2.ConnectionState != StateConnected {
		t.Fatalf("expected gen2 StateConnected, got %q", caps2.ConnectionState)
	}

	// Release generation 1's slow probe; it MUST NOT overwrite generation 2's cache or serve snapshots.
	close(releaseOldProbe)
	oldWg.Wait()

	if oldCaps.ConnectionState != StateDisconnected {
		t.Fatalf("expected evicted gen1 probe result to transition to StateDisconnected, got %q", oldCaps.ConnectionState)
	}
	cached, ok := factory.CapabilitiesRegistry().Get(cid)
	if !ok || cached.ConnectionState != StateConnected {
		t.Fatalf("stale gen1 probe overwrote or cleared gen2 capabilities: ok=%v caps=%+v", ok, cached)
	}
	if _, err := exec1.GetSnapshot(context.Background()); !errors.Is(err, ErrClusterDisconnected) {
		t.Fatalf("expected evicted exec1.GetSnapshot to return ErrClusterDisconnected, got %v", err)
	}
}

func TestClusterExecutorFactory_ConcurrentAccessRace(t *testing.T) {
	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)

	directClient := fake.NewSimpleClientset(&corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "p1", Namespace: "default"}})
	directClient.Discovery().(*fakediscovery.FakeDiscovery).Resources = standardFakeAPIResources(true)
	attachSSARReactor(directClient, map[string]bool{})

	im := cm.RegisterWithClientset("c-direct", directClient)
	defer im.Stop()

	cm.AgentRegistry().RegisterSession("c-agent", "sess-1")
	cm.AgentRegistry().SetSnapshotForSession("c-agent", "sess-1", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{{Name: "a1", Namespace: "default", Phase: "Running"}},
	})

	factory := NewClusterExecutorFactory(cm)
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < 15; i++ {
				target := "c-direct"
				if (id+i)%2 == 1 {
					target = "c-agent"
				}
				_, _ = factory.Capabilities(context.Background(), target)
				_, _ = factory.GetSnapshot(context.Background(), target)
				if i%7 == 0 {
					factory.Evict("c-agent")
				}
			}
		}(g)
	}
	wg.Wait()
}

func TestDirectExecutor_FailedReconciliationPreservesHealthyInformers(t *testing.T) {
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "app-1", Namespace: "default"}, Status: corev1.PodStatus{Phase: corev1.PodRunning}}
	client := fake.NewSimpleClientset(pod)
	fakeDisc := client.Discovery().(*fakediscovery.FakeDiscovery)
	fakeDisc.Resources = standardFakeAPIResources(true)

	var return429 atomic.Bool
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		if return429.Load() {
			return true, nil, apierrors.NewTooManyRequests("throttled during reconcile", 5)
		}
		sar := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview).DeepCopy()
		sar.Status.Allowed = true
		return true, sar, nil
	})

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	im := cm.RegisterWithClientset("cluster-transient", client)
	defer im.Stop()

	factory := NewClusterExecutorFactory(cm)
	ctx := context.Background()

	snap1, err := factory.GetSnapshot(ctx, "cluster-transient")
	if err != nil || len(snap1.Pods) != 1 {
		t.Fatalf("expected initial healthy snapshot with 1 pod, err=%v pods=%+v", err, snap1)
	}

	// Simulate transient 429 during explicit refresh reconciliation -> capability becomes temporarily_unavailable,
	// but healthy pods informer MUST NOT be revoked!
	return429.Store(true)
	capsReconcile, err := factory.CapabilitiesWithRefresh(ctx, "cluster-transient", true)
	if err != nil {
		t.Fatalf("unexpected factory error: %v", err)
	}
	if capsReconcile.Capabilities[CapTopology].State != CapTemporarilyUnavailable {
		t.Fatalf("expected CapTopology=temporarily_unavailable during 429 refresh, got %+v", capsReconcile.Capabilities[CapTopology])
	}
	if !im.IsMetricsAllowed() {
		t.Fatalf("expected healthy metricsAllowed preserved across transient 429")
	}

	return429.Store(false)
	snap2, err := factory.GetSnapshot(ctx, "cluster-transient")
	if err != nil || len(snap2.Pods) != 1 || snap2.Pods[0].Name != "app-1" {
		t.Fatalf("expected healthy pods preserved after transient failed reconciliation, err=%v snap=%+v", err, snap2)
	}
}
