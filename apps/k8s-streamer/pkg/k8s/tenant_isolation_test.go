package k8s

import (
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestClusterManager_NoSingleClusterOrAliasFallback(t *testing.T) {
	hub := websocket.NewHub()
	cm := NewClusterManager(hub)

	csA := fake.NewSimpleClientset()
	cm.RegisterWithClientset("cluster-tenant-a-uuid", csA)
	defer cm.ShutdownAll()

	// Exact match works
	if _, err := cm.GetClientset("cluster-tenant-a-uuid"); err != nil {
		t.Fatalf("expected exact clusterID lookup to succeed, got: %v", err)
	}

	// SEC-C3: Single-cluster fallback and local dev aliases must NEVER resolve to tenant A's cluster
	for _, bogusID := range []string{"", "cluster-tenant-b-uuid", "minikube", "minikube-local", "local", "default", "development", "CLUSTER-TENANT-A-UUID"} {
		if _, err := cm.GetClientset(bogusID); err == nil {
			t.Fatalf("expected GetClientset(%q) to fail, but it silently resolved to another cluster", bogusID)
		}
		if _, err := cm.GetStreamClientset(bogusID); err == nil {
			t.Fatalf("expected GetStreamClientset(%q) to fail, but it silently resolved to another cluster", bogusID)
		}
		if _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, err := cm.GetClusterSnapshot(bogusID); err == nil {
			t.Fatalf("expected GetClusterSnapshot(%q) to fail, but it returned another cluster's snapshot", bogusID)
		}
	}
}

func TestAgentRegistry_NoSingleAgentFallback(t *testing.T) {
	reg := NewAgentRegistry()
	reg.SetSnapshot("agent-tenant-a-uuid", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{{Name: "secret-pod", Namespace: "prod"}},
	})

	if snap, ok := reg.GetSnapshot("agent-tenant-a-uuid"); !ok || snap == nil || len(snap.Pods) != 1 {
		t.Fatalf("expected exact agent cluster lookup to return snapshot")
	}

	// SEC-C3: Different cluster ID must NEVER receive tenant A's snapshot even when len == 1
	for _, otherID := range []string{"", "agent-tenant-b-uuid", "minikube", "default"} {
		if snap, ok := reg.GetSnapshot(otherID); ok || snap != nil {
			t.Fatalf("expected GetSnapshot(%q) to return (nil, false), got (%+v, %v)", otherID, snap, ok)
		}
	}
}

func TestInformerManager_TopologyWorksWithoutSecretsAccess(t *testing.T) {
	node := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "worker-1"}}
	svc := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "api-svc", Namespace: "default"}}
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default"},
		Data:       map[string]string{"ENV": "prod"},
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "api-pod", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "api",
					EnvFrom: []corev1.EnvFromSource{
						{SecretRef: &corev1.SecretEnvSource{LocalObjectReference: corev1.LocalObjectReference{Name: "db-credentials"}}},
					},
				},
			},
		},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "db-credentials", Namespace: "default"},
		Data:       map[string][]byte{"PASSWORD": []byte("super-secret-value")},
	}

	cs := fake.NewSimpleClientset(node, svc, cm, pod, secret)
	var secretAPICalls atomic.Int32
	cs.PrependReactor("*", "secrets", func(action k8stesting.Action) (bool, runtime.Object, error) {
		secretAPICalls.Add(1)
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "secrets"}, "", nil)
	})

	hub := websocket.NewHub()
	im := NewInformerManagerWithClientset(cs, hub, "cluster-no-secrets")
	stopCh := make(chan struct{})
	defer close(stopCh)
	go im.Start(stopCh)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snap := BuildClusterSnapshot(im)
		if len(snap.Pods) == 1 && len(snap.Nodes) == 1 && len(snap.Services) == 1 && len(snap.ConfigMaps) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	snap := BuildClusterSnapshot(im)
	if len(snap.Pods) != 1 || len(snap.Nodes) != 1 || len(snap.Services) != 1 || len(snap.ConfigMaps) != 1 {
		t.Fatalf("SEC-L3: expected topology discovery to succeed without Secrets RBAC, got pods=%d nodes=%d svcs=%d cms=%d",
			len(snap.Pods), len(snap.Nodes), len(snap.Services), len(snap.ConfigMaps))
	}
	if secretAPICalls.Load() != 0 {
		t.Fatalf("SEC-L3: expected 0 Kubernetes secrets API requests by default, got %d", secretAPICalls.Load())
	}
	if len(snap.Secrets) != 0 {
		t.Fatalf("SEC-L3: expected 0 Secret objects exposed in snapshot, got %d", len(snap.Secrets))
	}
	if len(snap.Pods[0].Secrets) != 1 || snap.Pods[0].Secrets[0].Name != "db-credentials" {
		t.Fatalf("SEC-L3: expected pod spec Secrets metadata to still be extracted, got %+v", snap.Pods[0].Secrets)
	}
}

