package k8s

import (
	"bufio"
	"context"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"

	wshub "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// ---- Helpers ----

func newTestHub() *wshub.Hub {
	hub := wshub.NewHub()
	go hub.Run()
	time.Sleep(10 * time.Millisecond)
	return hub
}

func newFakeClientsetWithPod(namespace, podName, containerName string) *fake.Clientset {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      podName,
			Namespace: namespace,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: containerName, Image: "nginx:latest"},
			},
		},
	}
	return fake.NewSimpleClientset(pod)
}

// ---- Tests ----

func TestStartStream_IsIdempotent(t *testing.T) {
	hub := newTestHub()
	ls := NewPodLogStreamer(hub)
	clientset := newFakeClientsetWithPod("default", "api-pod", "api")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_ = ls.StartStream(ctx, clientset, "cluster-1", "default", "api-pod", "api", 10)
	_ = ls.StartStream(ctx, clientset, "cluster-1", "default", "api-pod", "api", 10)
	time.Sleep(30 * time.Millisecond)

	// Only one stream session must be registered regardless of duplicate calls
	if ls.ActiveStreamCount() != 1 {
		t.Errorf("Expected 1 active stream (idempotent), got %d", ls.ActiveStreamCount())
	}
}

func TestStopStream_CleansUpSession(t *testing.T) {
	hub := newTestHub()
	ls := NewPodLogStreamer(hub)
	clientset := newFakeClientsetWithPod("default", "worker-pod", "worker")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_ = ls.StartStream(ctx, clientset, "cluster-1", "default", "worker-pod", "worker", 10)
	time.Sleep(30 * time.Millisecond)

	ls.StopStream("cluster-1", "default", "worker-pod", "worker")
	time.Sleep(30 * time.Millisecond)

	if ls.ActiveStreamCount() != 0 {
		t.Errorf("Expected 0 active streams after stop, got %d", ls.ActiveStreamCount())
	}
}

func TestStopAllForCluster_OnlyRemovesTargetCluster(t *testing.T) {
	hub := newTestHub()
	ls := NewPodLogStreamer(hub)

	c1 := newFakeClientsetWithPod("default", "pod-a", "a")
	c2 := newFakeClientsetWithPod("default", "pod-b", "b")

	ctx := context.Background()
	_ = ls.StartStream(ctx, c1, "cluster-alpha", "default", "pod-a", "a", 10)
	_ = ls.StartStream(ctx, c2, "cluster-beta", "default", "pod-b", "b", 10)
	time.Sleep(40 * time.Millisecond)

	if ls.ActiveStreamCount() != 2 {
		t.Fatalf("Expected 2 active streams, got %d", ls.ActiveStreamCount())
	}

	ls.StopAllForCluster("cluster-alpha")
	time.Sleep(40 * time.Millisecond)

	if ls.ActiveStreamCount() != 1 {
		t.Errorf("Expected 1 active stream after stopping cluster-alpha, got %d", ls.ActiveStreamCount())
	}
}

func TestContextCancellation_StopsStream(t *testing.T) {
	hub := newTestHub()
	ls := NewPodLogStreamer(hub)
	clientset := newFakeClientsetWithPod("default", "ctx-pod", "app")

	ctx, cancel := context.WithCancel(context.Background())
	_ = ls.StartStream(ctx, clientset, "cluster-ctx", "default", "ctx-pod", "app", 10)
	time.Sleep(30 * time.Millisecond)

	// Cancel the parent context — stream must self-terminate
	cancel()
	time.Sleep(80 * time.Millisecond)

	if ls.ActiveStreamCount() != 0 {
		t.Errorf("Expected 0 active streams after context cancel, got %d", ls.ActiveStreamCount())
	}
}

func TestResolveContainer_DefaultsToFirstContainer(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "test-pod", Namespace: "default"},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "main", Image: "nginx"},
				{Name: "sidecar", Image: "envoy"},
			},
		},
	}
	clientset := fake.NewSimpleClientset(pod)

	container, err := resolveContainer(clientset, "default", "test-pod", "")
	if err != nil {
		t.Fatalf("resolveContainer returned error: %v", err)
	}
	if container != "main" {
		t.Errorf("Expected 'main' container, got '%s'", container)
	}
}

func TestResolveContainer_RespectsExplicitName(t *testing.T) {
	clientset := fake.NewSimpleClientset()
	container, err := resolveContainer(clientset, "default", "irrelevant-pod", "sidecar")
	if err != nil {
		t.Fatalf("resolveContainer returned error: %v", err)
	}
	if container != "sidecar" {
		t.Errorf("Expected 'sidecar', got '%s'", container)
	}
}

// TestLogLineScanner verifies the bufio.Scanner handles multi-line log output without dropping lines.
func TestLogLineScanner_HandlesMultiLineOutput(t *testing.T) {
	logData := "2026-08-19T06:00:00Z INFO starting server\n" +
		"2026-08-19T06:00:01Z DEBUG listening on :8080\n" +
		"2026-08-19T06:00:02Z ERROR connection refused\n"

	reader := strings.NewReader(logData)
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	if len(lines) != 3 {
		t.Errorf("Expected 3 log lines, got %d", len(lines))
	}
	if !strings.Contains(lines[2], "connection refused") {
		t.Errorf("Third line content mismatch: %s", lines[2])
	}
}

func TestActiveStreamCount_ReflectsRegistry(t *testing.T) {
	hub := newTestHub()
	ls := NewPodLogStreamer(hub)

	if ls.ActiveStreamCount() != 0 {
		t.Errorf("Expected 0 streams initially, got %d", ls.ActiveStreamCount())
	}

	c1 := newFakeClientsetWithPod("ns1", "pod1", "c1")
	c2 := newFakeClientsetWithPod("ns2", "pod2", "c2")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	_ = ls.StartStream(ctx, c1, "cl1", "ns1", "pod1", "c1", 5)
	_ = ls.StartStream(ctx, c2, "cl2", "ns2", "pod2", "c2", 5)
	time.Sleep(40 * time.Millisecond)

	if ls.ActiveStreamCount() != 2 {
		t.Errorf("Expected 2 active streams, got %d", ls.ActiveStreamCount())
	}
}

// --- compile-time interface check ---
var _ runtime.Object = (*corev1.Pod)(nil)
