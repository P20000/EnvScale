package server

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestParseLogTimestamp(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expectedLevel string
		expectedMsg   string
		expectTime    bool
	}{
		{
			name:          "RFC3339Nano with INFO",
			input:         "2026-10-30T18:21:47.123456789Z Ready to accept connections",
			expectedLevel: "INFO",
			expectedMsg:   "Ready to accept connections",
			expectTime:    true,
		},
		{
			name:          "RFC3339 with ERROR",
			input:         "2026-10-30T18:21:47Z [FATAL] Database connection failed",
			expectedLevel: "ERROR",
			expectedMsg:   "[FATAL] Database connection failed",
			expectTime:    true,
		},
		{
			name:          "RFC3339 with WARN",
			input:         "2026-10-30T18:21:47Z Warning: memory limit approaching 90%",
			expectedLevel: "WARN",
			expectedMsg:   "Warning: memory limit approaching 90%",
			expectTime:    true,
		},
		{
			name:          "Plain text without timestamp",
			input:         "Standard unformatted console log line",
			expectedLevel: "INFO",
			expectedMsg:   "Standard unformatted console log line",
			expectTime:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tsStr, parsedTime, level, msg := parseLogTimestamp(tt.input)
			if tsStr == "" {
				t.Errorf("expected non-empty timestamp string")
			}
			if tt.expectTime && parsedTime.IsZero() {
				t.Errorf("expected parsedTime to not be zero")
			}
			if level != tt.expectedLevel {
				t.Errorf("expected level %q, got %q", tt.expectedLevel, level)
			}
			if msg != tt.expectedMsg {
				t.Errorf("expected msg %q, got %q", tt.expectedMsg, msg)
			}
		})
	}
}

func TestContainerLifecycleHelpers(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-pod",
			Namespace: "test-ns",
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "app",
					State: corev1.ContainerState{
						Waiting: &corev1.ContainerStateWaiting{
							Reason:  "CrashLoopBackOff",
							Message: "back-off 5m restarting failed container",
						},
					},
				},
				{
					Name: "sidecar",
					State: corev1.ContainerState{
						Terminated: &corev1.ContainerStateTerminated{
							ExitCode: 0,
							Reason:   "Completed",
						},
					},
				},
			},
			InitContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "init-db",
					State: corev1.ContainerState{
						Terminated: &corev1.ContainerStateTerminated{
							ExitCode: 1,
							Reason:   "Error",
						},
					},
				},
			},
		},
	}

	// 1. App container is waiting
	waiting, reason := isContainerWaiting(pod, "app", false)
	if !waiting || reason == "" {
		t.Fatalf("expected app to be waiting with reason, got waiting=%v, reason=%q", waiting, reason)
	}

	// 2. Sidecar is terminated with exit code 0
	term, code := isContainerTerminated(pod, "sidecar", false)
	if !term || code != 0 {
		t.Fatalf("expected sidecar to be terminated with exit 0, got term=%v, code=%d", term, code)
	}

	// 3. Init container terminated with exit code 1
	initTerm, initCode := isContainerTerminated(pod, "init-db", true)
	if !initTerm || initCode != 1 {
		t.Fatalf("expected init container to be terminated with exit 1, got term=%v, code=%d", initTerm, initCode)
	}
}

func TestDiscoverContainersClusterWideAndNamespace(t *testing.T) {
	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-server-1",
			Namespace: "prod",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "api"},
				{Name: "proxy"},
			},
			InitContainers: []corev1.Container{
				{Name: "migrate"},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			InitContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "migrate",
					State: corev1.ContainerState{
						Terminated: &corev1.ContainerStateTerminated{ExitCode: 0},
					},
				},
			},
		},
	}

	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "worker-job-1",
			Namespace: "staging",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "worker"},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	clientset := fake.NewSimpleClientset(pod1, pod2)
	outChan := make(chan interface{}, 100)
	mgr := NewLogStreamManager(clientset, outChan)
	ctx := context.Background()

	// 1. Cluster-wide discovery (namespace = "all" or "")
	clusterTargets, err := mgr.DiscoverContainers(ctx, "all", "all", "all")
	if err != nil {
		t.Fatalf("unexpected error discovering cluster-wide containers: %v", err)
	}
	// Expected: 2 app containers from pod1 + 1 app container from pod2 = 3 targets
	if len(clusterTargets) != 3 {
		t.Fatalf("expected 3 cluster-wide targets, got %d", len(clusterTargets))
	}

	// Verify source identifiers have namespace/pod/container format
	for _, target := range clusterTargets {
		expectedPrefix := target.Namespace + "/" + target.PodName + "/" + target.ContainerName
		if target.SourceID != expectedPrefix {
			t.Errorf("expected sourceID %q, got %q", expectedPrefix, target.SourceID)
		}
	}

	// 2. Namespace-scoped discovery (namespace = "prod")
	prodTargets, err := mgr.DiscoverContainers(ctx, "prod", "all", "all")
	if err != nil {
		t.Fatalf("unexpected error discovering prod containers: %v", err)
	}
	if len(prodTargets) != 2 {
		t.Fatalf("expected 2 prod targets, got %d", len(prodTargets))
	}

	// 3. Workload-specific discovery (name = "worker")
	workerTargets, err := mgr.DiscoverContainers(ctx, "staging", "worker", "deployment")
	if err != nil {
		t.Fatalf("unexpected error discovering worker containers: %v", err)
	}
	if len(workerTargets) != 1 || workerTargets[0].PodName != "worker-job-1" {
		t.Fatalf("expected 1 worker target, got %v", workerTargets)
	}
}
