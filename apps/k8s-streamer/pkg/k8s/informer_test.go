package k8s

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestExtractPodDelta(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "auth-service-pod-1",
			Namespace:         "default",
			CreationTimestamp: metav1.Now(),
			Labels: map[string]string{
				"app": "auth-service",
			},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-worker-1",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name:         "auth-container",
					RestartCount: 3,
				},
			},
		},
	}

	hub := websocket.NewHub()
	im := NewInformerManagerWithClientset(fake.NewSimpleClientset(), hub, "test-cluster-1")

	delta := im.extractPodDelta(pod)

	if delta.Name != "auth-service-pod-1" {
		t.Errorf("Expected pod name 'auth-service-pod-1', got '%s'", delta.Name)
	}

	if delta.Namespace != "default" {
		t.Errorf("Expected namespace 'default', got '%s'", delta.Namespace)
	}

	if delta.Phase != "Running" {
		t.Errorf("Expected phase 'Running', got '%s'", delta.Phase)
	}

	if delta.RestartCount != 3 {
		t.Errorf("Expected restart count 3, got %d", delta.RestartCount)
	}

	if delta.NodeName != "node-worker-1" {
		t.Errorf("Expected node name 'node-worker-1', got '%s'", delta.NodeName)
	}
}

func TestExtractPodDeltaCrashLoopBackOff(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "failing-pod",
			Namespace: "default",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "failing-container",
					State: corev1.ContainerState{
						Waiting: &corev1.ContainerStateWaiting{
							Reason: "CrashLoopBackOff",
						},
					},
					RestartCount: 12,
				},
			},
		},
	}

	hub := websocket.NewHub()
	im := NewInformerManagerWithClientset(fake.NewSimpleClientset(), hub, "test-cluster-1")

	delta := im.extractPodDelta(pod)

	if delta.Phase != "CrashLoopBackOff" {
		t.Errorf("Expected phase 'CrashLoopBackOff', got '%s'", delta.Phase)
	}
}

func TestClusterManagerLifecycle(t *testing.T) {
	hub := websocket.NewHub()
	cm := NewClusterManager(hub)

	clientset := fake.NewSimpleClientset()
	clusterID := "test-workspace-123"

	im := cm.RegisterWithClientset(clusterID, clientset)

	if !im.IsRunning() {
		t.Errorf("Expected informer manager to be running")
	}

	if cm.ActiveClusterCount() != 1 {
		t.Errorf("Expected 1 active cluster, got %d", cm.ActiveClusterCount())
	}

	clusters := cm.ListClusters()
	if running, ok := clusters[clusterID]; !ok || !running {
		t.Errorf("Expected cluster %s to be listed as running", clusterID)
	}

	// Add pod to fake clientset and trigger informer event
	testPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-pod-2",
			Namespace: "default",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	_, err := clientset.CoreV1().Pods("default").Create(t.Context(), testPod, metav1.CreateOptions{})
	if err != nil {
		t.Fatalf("Failed to create pod in fake clientset: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	// Test unregistering
	err = cm.UnregisterCluster(clusterID)
	if err != nil {
		t.Errorf("Failed to unregister cluster: %v", err)
	}

	if cm.ActiveClusterCount() != 0 {
		t.Errorf("Expected 0 active clusters after unregistering, got %d", cm.ActiveClusterCount())
	}

	if im.IsRunning() {
		t.Errorf("Expected informer manager to be stopped after unregistering")
	}
}
