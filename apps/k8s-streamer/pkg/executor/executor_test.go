package executor

import (
	"context"
	"errors"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func standardFakeAPIResources(includeMetrics bool) []*metav1.APIResourceList {
	resources := []*metav1.APIResourceList{
		{GroupVersion: "v1"},
		{GroupVersion: "apps/v1"},
		{GroupVersion: "batch/v1"},
		{GroupVersion: "networking.k8s.io/v1"},
		{GroupVersion: "autoscaling/v2"},
		{GroupVersion: "policy/v1"},
		{GroupVersion: "rbac.authorization.k8s.io/v1"},
	}
	if includeMetrics {
		resources = append(resources, &metav1.APIResourceList{GroupVersion: "metrics.k8s.io/v1beta1"})
	}
	return resources
}

func attachSSARReactor(client *fake.Clientset, denied map[string]bool) {
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		createAct, ok := action.(k8stesting.CreateAction)
		if !ok {
			return false, nil, nil
		}
		sar, ok := createAct.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		if !ok || sar.Spec.ResourceAttributes == nil {
			return false, nil, nil
		}
		ra := sar.Spec.ResourceAttributes
		key := ra.Group + "/" + ra.Resource + ":" + ra.Subresource + ":" + ra.Verb
		simpleKey := ra.Group + "/" + ra.Resource
		isDenied := denied[key] || denied[simpleKey]
		out := sar.DeepCopy()
		out.Status.Allowed = !isDenied
		if isDenied {
			out.Status.Reason = "denied by test RBAC policy"
		}
		return true, out, nil
	})
}

func TestClusterExecutorFactory_SelectsModeAndNeverFallsBack(t *testing.T) {
	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)

	directClient := fake.NewSimpleClientset()
	directIM := cm.RegisterWithClientset("cluster-direct", directClient)
	defer directIM.Stop()

	cm.AgentRegistry().SetSnapshot("cluster-agent", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{{Name: "agent-pod", Namespace: "default", Phase: "Running"}},
	})

	factory := NewClusterExecutorFactory(cm)

	execDirect, err := factory.GetExecutor("cluster-direct")
	if err != nil {
		t.Fatalf("expected direct executor, got error: %v", err)
	}
	if execDirect.Mode() != ModeDirect {
		t.Fatalf("expected ModeDirect, got %q", execDirect.Mode())
	}

	execAgent, err := factory.GetExecutor("cluster-agent")
	if err != nil {
		t.Fatalf("expected agent executor, got error: %v", err)
	}
	if execAgent.Mode() != ModeAgent {
		t.Fatalf("expected ModeAgent, got %q", execAgent.Mode())
	}

	if _, err := factory.GetExecutor("cluster-unknown"); !errors.Is(err, ErrClusterNotFound) {
		t.Fatalf("expected ErrClusterNotFound for unregistered ID, got %v", err)
	}
	if _, err := factory.GetExecutor(""); !errors.Is(err, ErrClusterNotFound) {
		t.Fatalf("expected ErrClusterNotFound for empty ID, got %v", err)
	}

	if err := cm.UnregisterCluster("cluster-direct"); err != nil {
		t.Fatalf("unexpected unregister error: %v", err)
	}
	factory.Evict("cluster-direct")
	if _, err := factory.GetExecutor("cluster-direct"); !errors.Is(err, ErrClusterNotFound) {
		t.Fatalf("expected ErrClusterNotFound after unregister+evict, got %v", err)
	}
}

func TestDirectExecutor_RestrictedRBACDegradesWithoutHanging(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "default"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
	}

	client := fake.NewSimpleClientset(pod, dep)
	fakeDisc := client.Discovery().(*fakediscovery.FakeDiscovery)
	fakeDisc.Resources = standardFakeAPIResources(false) // omit metrics.k8s.io and snapshot.storage.k8s.io

	attachSSARReactor(client, map[string]bool{
		"/nodes":                                  true,
		"rbac.authorization.k8s.io/clusterroles":  true,
		"policy/poddisruptionbudgets":             true,
		"apps/deployments:scale:patch":            true,
		"/pods:log:get":                           true,
	})

	// Simulate 403 Forbidden if an unpermitted list/watch were attempted.
	for _, res := range []string{"nodes", "clusterroles", "poddisruptionbudgets"} {
		target := res
		client.PrependReactor("list", target, func(action k8stesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: target}, "", errors.New("forbidden"))
		})
		client.PrependReactor("watch", target, func(action k8stesting.Action) (bool, runtime.Object, error) {
			return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: target}, "", errors.New("forbidden"))
		})
	}

	caps := ProbeDirectCapabilities(context.Background(), "cluster-restricted", client, false)
	if caps.ConnectionState != StateDegraded {
		t.Fatalf("expected ConnectionState=degraded under restricted RBAC, got %q", caps.ConnectionState)
	}
	if caps.Capabilities[CapTopology].State != CapSupportedWorking {
		t.Fatalf("expected topology supported_working, got %+v", caps.Capabilities[CapTopology])
	}
	if caps.Resources["core/v1/nodes"].State != CapPermissionDenied {
		t.Fatalf("expected core/v1/nodes permission_denied, got %+v", caps.Resources["core/v1/nodes"])
	}
	if caps.Resources["rbac.authorization.k8s.io/v1/clusterroles"].State != CapPermissionDenied {
		t.Fatalf("expected clusterroles permission_denied, got %+v", caps.Resources["rbac.authorization.k8s.io/v1/clusterroles"])
	}
	if caps.Capabilities[CapPDBValidation].State != CapPermissionDenied {
		t.Fatalf("expected pdb_validation permission_denied, got %+v", caps.Capabilities[CapPDBValidation])
	}
	if caps.Resources["core/v1/secrets"].State != CapPermissionDenied {
		t.Fatalf("expected core/v1/secrets permission_denied by SEC-L3, got %+v", caps.Resources["core/v1/secrets"])
	}
	if caps.Capabilities[CapMetrics].State != CapClusterUnavailable {
		t.Fatalf("expected metrics cluster_unavailable without metrics.k8s.io, got %+v", caps.Capabilities[CapMetrics])
	}
	if caps.Resources["snapshot.storage.k8s.io/v1/volumesnapshotcontents"].State != CapClusterUnavailable {
		t.Fatalf("expected volumesnapshotcontents cluster_unavailable, got %+v", caps.Resources["snapshot.storage.k8s.io/v1/volumesnapshotcontents"])
	}
	if caps.Capabilities[CapLogs].State != CapPermissionDenied {
		t.Fatalf("expected logs permission_denied, got %+v", caps.Capabilities[CapLogs])
	}
	if caps.Capabilities[CapDeploymentScale].State != CapPermissionDenied {
		t.Fatalf("expected deployment_scale permission_denied, got %+v", caps.Capabilities[CapDeploymentScale])
	}
	if caps.Capabilities[CapChaosOOMPressure].State != CapNotImplemented {
		t.Fatalf("expected chaos_oom_pressure not_implemented, got %+v", caps.Capabilities[CapChaosOOMPressure])
	}
	if caps.Capabilities[CapResourceApply].State != CapNotImplemented {
		t.Fatalf("expected resource_apply not_implemented, got %+v", caps.Capabilities[CapResourceApply])
	}

	hub := websocket.NewHub()
	im := k8s.NewInformerManagerWithClientset(client, hub, "cluster-restricted")
	im.SetAllowedResources(AllowedResourceMap(caps))
	im.StartAsync()
	defer im.Stop()

	reg := NewClusterCapabilityRegistry()
	exec := NewDirectExecutor("cluster-restricted", im, reg)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	start := time.Now()
	snap, err := exec.GetSnapshot(ctx)
	if err != nil {
		t.Fatalf("expected degraded GetSnapshot to succeed without hanging, got error: %v", err)
	}
	if time.Since(start) > 1500*time.Millisecond {
		t.Fatalf("GetSnapshot took too long (%v); WaitForCacheSync may have stalled", time.Since(start))
	}
	if len(snap.Pods) != 1 || snap.Pods[0].Name != "web-1" {
		t.Fatalf("expected pod web-1 in snapshot, got %+v", snap.Pods)
	}
	if len(snap.Nodes) != 0 {
		t.Fatalf("expected 0 nodes when core/v1/nodes permission_denied, got %d", len(snap.Nodes))
	}
	if snap.ConnectionMode != ModeDirect || snap.ConnectionState != StateDegraded {
		t.Fatalf("unexpected mode/state on snapshot: %q / %q", snap.ConnectionMode, snap.ConnectionState)
	}
}

type failingDiscoveryClient struct {
	*fake.Clientset
}

type failingDiscovery struct {
	*fakediscovery.FakeDiscovery
}

func (f *failingDiscovery) ServerGroups() (*metav1.APIGroupList, error) {
	return nil, errors.New("dial tcp 127.0.0.1:6443: connect: connection refused")
}

func (c *failingDiscoveryClient) Discovery() discovery.DiscoveryInterface {
	return &failingDiscovery{FakeDiscovery: c.Clientset.Discovery().(*fakediscovery.FakeDiscovery)}
}

func TestDirectExecutor_APIServerFailureDistinguishableFromAgentDisconnect(t *testing.T) {
	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)

	// 1. Disconnected agent cluster (with prior snapshot) -> ErrClusterDisconnected.
	cm.AgentRegistry().RegisterSession("cluster-agent-disc", "sess-1")
	cm.AgentRegistry().SetSnapshot("cluster-agent-disc", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{{Name: "p1", Namespace: "default"}},
	})
	cm.AgentRegistry().MarkDisconnectedSession("cluster-agent-disc", "sess-1")

	factory := NewClusterExecutorFactory(cm)
	if _, err := factory.GetSnapshot(context.Background(), "cluster-agent-disc"); !errors.Is(err, ErrClusterDisconnected) {
		t.Fatalf("expected ErrClusterDisconnected for disconnected agent, got %v", err)
	}
	agentCaps, err := factory.Capabilities(context.Background(), "cluster-agent-disc")
	if err != nil {
		t.Fatalf("expected capabilities lookup to succeed for disconnected agent, got %v", err)
	}
	if agentCaps.ConnectionState != StateDisconnected {
		t.Fatalf("expected StateDisconnected, got %q", agentCaps.ConnectionState)
	}

	// 2. Waiting-for-agent session before first snapshot -> StateWaitingForAgent & ErrClusterDisconnected.
	cm.AgentRegistry().RegisterSession("cluster-agent-wait", "sess-2")
	cm.AgentRegistry().MarkDisconnectedSession("cluster-agent-wait", "sess-2")
	waitCaps, err := factory.Capabilities(context.Background(), "cluster-agent-wait")
	if err != nil {
		t.Fatalf("expected capabilities for waiting agent, got %v", err)
	}
	if waitCaps.ConnectionState != StateWaitingForAgent {
		t.Fatalf("expected StateWaitingForAgent, got %q", waitCaps.ConnectionState)
	}

	// 3. Direct cluster with stopped InformerManager -> ErrClusterDisconnected.
	imStopped := cm.RegisterWithClientset("cluster-direct-stopped", fake.NewSimpleClientset())
	imStopped.Stop()
	if _, err := factory.GetSnapshot(context.Background(), "cluster-direct-stopped"); !errors.Is(err, ErrClusterDisconnected) {
		t.Fatalf("expected ErrClusterDisconnected for stopped direct informer, got %v", err)
	}

	// 4. Direct running InformerManager whose API discovery fails -> ErrClusterUnreachable.
	unreachableClient := &failingDiscoveryClient{Clientset: fake.NewSimpleClientset()}
	imUnreachable := cm.RegisterWithClientset("cluster-direct-unreachable", unreachableClient)
	defer imUnreachable.Stop()
	if _, err := factory.GetSnapshot(context.Background(), "cluster-direct-unreachable"); !errors.Is(err, ErrClusterUnreachable) {
		t.Fatalf("expected ErrClusterUnreachable for API server failure, got %v", err)
	}
	unreachCaps, err := factory.Capabilities(context.Background(), "cluster-direct-unreachable")
	if err != nil {
		t.Fatalf("expected capabilities lookup for unreachable direct cluster, got %v", err)
	}
	if unreachCaps.ConnectionState != StateDisconnected {
		t.Fatalf("expected StateDisconnected when discovery cannot reach API server, got %q", unreachCaps.ConnectionState)
	}
	if unreachCaps.Capabilities[CapTopology].State != CapTemporarilyUnavailable {
		t.Fatalf("expected topology temporarily_unavailable when API unreachable, got %+v", unreachCaps.Capabilities[CapTopology])
	}
}

func TestAgentExecutor_SnapshotAndV1CapabilitiesParity(t *testing.T) {
	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	cm.AgentRegistry().RegisterSession("cluster-agent-v1", "sess-v1")
	cm.AgentRegistry().SetSnapshot("cluster-agent-v1", types.ClusterSnapshot{
		Pods:        []types.PodStatusDelta{{Name: "api-0", Namespace: "prod", Phase: "Running"}},
		Nodes:       []types.NodeStatusDelta{{Name: "node-a", Status: "Ready"}},
		Services:    []types.ServiceStatusDelta{{Name: "api-svc", Namespace: "prod"}},
		Deployments: []types.DeploymentStatusDelta{{Name: "api", Namespace: "prod", Replicas: 2}},
		Roles:       []types.RoleDelta{{Name: "pod-reader", Namespace: "prod"}},
	})

	factory := NewClusterExecutorFactory(cm)
	snap, err := factory.GetSnapshot(context.Background(), "cluster-agent-v1")
	if err != nil {
		t.Fatalf("unexpected Agent GetSnapshot error: %v", err)
	}
	if snap.ConnectionMode != ModeAgent || snap.ConnectionState != StateConnected {
		t.Fatalf("expected agent/connected, got %q/%q", snap.ConnectionMode, snap.ConnectionState)
	}
	if len(snap.Pods) != 1 || snap.Pods[0].Name != "api-0" {
		t.Fatalf("expected api-0 pod in agent snapshot, got %+v", snap.Pods)
	}
	if len(snap.Roles) != 1 || snap.Roles[0].Name != "pod-reader" {
		t.Fatalf("expected role snapshot parity on agent, got %+v", snap.Roles)
	}
	if snap.Capabilities.Capabilities[CapTopology].State != CapSupportedWorking {
		t.Fatalf("expected agent v1 topology supported_working, got %+v", snap.Capabilities.Capabilities[CapTopology])
	}
	if snap.Capabilities.Capabilities[CapLogs].State != CapNotImplemented {
		t.Fatalf("expected agent v1 logs not_implemented, got %+v", snap.Capabilities.Capabilities[CapLogs])
	}
	if snap.Capabilities.Resources["core/v1/secrets"].State != CapPermissionDenied {
		t.Fatalf("expected agent secrets permission_denied per SEC-L3, got %+v", snap.Capabilities.Resources["core/v1/secrets"])
	}

	exec, err := factory.GetExecutor("cluster-agent-v1")
	if err != nil {
		t.Fatalf("unexpected GetExecutor error: %v", err)
	}
	if _, err := exec.StartLogStream(context.Background(), LogStreamRequest{}, nil); !errors.Is(err, ErrCapabilityUnsupported) {
		t.Fatalf("expected ErrCapabilityUnsupported for un-migrated StartLogStream, got %v", err)
	}
}
