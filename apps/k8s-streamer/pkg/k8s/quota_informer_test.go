package k8s

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestExtractResourceQuotaDelta(t *testing.T) {
	hub := websocket.NewHub()
	clientset := fake.NewSimpleClientset()
	im := NewInformerManagerWithClientset(clientset, hub, "test-cluster")

	rq := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "compute-quota",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("2"),
				corev1.ResourceMemory: resource.MustParse("2Gi"),
				corev1.ResourcePods:   resource.MustParse("10"),
			},
			Used: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("1800m"), // 90%
				corev1.ResourceMemory: resource.MustParse("1Gi"),   // 50%
				corev1.ResourcePods:   resource.MustParse("5"),     // 50%
			},
		},
	}

	delta := im.extractResourceQuotaDelta(rq)

	if delta.Name != "compute-quota" {
		t.Fatalf("expected name compute-quota, got %s", delta.Name)
	}
	if delta.Namespace != "default" {
		t.Fatalf("expected namespace default, got %s", delta.Namespace)
	}
	if delta.CPULimitCores != 2.0 {
		t.Fatalf("expected 2.0 CPU cores limit, got %f", delta.CPULimitCores)
	}
	if delta.CPUUsedCores != 1.8 {
		t.Fatalf("expected 1.8 CPU cores used, got %f", delta.CPUUsedCores)
	}
	if delta.CPUUtilizationPct < 89.9 || delta.CPUUtilizationPct > 90.1 {
		t.Fatalf("expected ~90%% CPU utilization, got %f", delta.CPUUtilizationPct)
	}
	if !delta.IsWarning {
		t.Fatalf("expected isWarning to be true (>85%% CPU), got false")
	}
	if delta.IsBreached {
		t.Fatalf("expected isBreached to be false (<100%%), got true")
	}
}

func TestExtractLimitRangeDelta(t *testing.T) {
	hub := websocket.NewHub()
	clientset := fake.NewSimpleClientset()
	im := NewInformerManagerWithClientset(clientset, hub, "test-cluster")

	lr := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "core-limits",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		Spec: corev1.LimitRangeSpec{
			Limits: []corev1.LimitRangeItem{
				{
					Type: corev1.LimitTypeContainer,
					Default: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
					DefaultRequest: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Max: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("1"),
						corev1.ResourceMemory: resource.MustParse("1Gi"),
					},
					Min: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("50m"),
						corev1.ResourceMemory: resource.MustParse("64Mi"),
					},
				},
			},
		},
	}

	delta := im.extractLimitRangeDelta(lr)

	if delta.Name != "core-limits" {
		t.Fatalf("expected name core-limits, got %s", delta.Name)
	}
	if len(delta.Limits) != 1 {
		t.Fatalf("expected 1 limit item, got %d", len(delta.Limits))
	}
	if delta.Limits[0].Type != "Container" {
		t.Fatalf("expected Container type, got %s", delta.Limits[0].Type)
	}
	if delta.Limits[0].Default["cpu"] != "500m" {
		t.Fatalf("expected 500m default cpu, got %s", delta.Limits[0].Default["cpu"])
	}
}
