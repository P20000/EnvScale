package k8s

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

type PodMetricData struct {
	CPUUsagePct   float64
	MemoryUsageMb float64
}

// FetchPodMetricsMap fetches real-time pod metrics from metrics-server clientset
func (im *InformerManager) FetchPodMetricsMap() map[string]PodMetricData {
	metricsMap := make(map[string]PodMetricData)
	if im.metricsClient == nil {
		return metricsMap
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	podMetricsList, err := im.metricsClient.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return metricsMap
	}

	for _, pm := range podMetricsList.Items {
		var totalMcores int64 = 0
		var totalMemBytes int64 = 0
		for _, c := range pm.Containers {
			totalMcores += c.Usage.Cpu().MilliValue()
			totalMemBytes += c.Usage.Memory().Value()
		}
		memMiB := float64(totalMemBytes) / (1024 * 1024)
		key := fmt.Sprintf("%s/%s", pm.Namespace, pm.Name)
		metricsMap[key] = PodMetricData{
			CPUUsagePct:   float64(totalMcores),
			MemoryUsageMb: memMiB,
		}
	}
	return metricsMap
}

// startMetricsPulse periodically refreshes pod telemetry and broadcasts updates
func (im *InformerManager) startMetricsPulse(stopCh <-chan struct{}) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			if !im.IsRunning() {
				return
			}
			metricsMap := im.FetchPodMetricsMap()
			if len(metricsMap) == 0 {
				continue
			}

			podList := im.factory.Core().V1().Pods().Informer().GetStore().List()
			for _, obj := range podList {
				if pod, ok := obj.(*corev1.Pod); ok {
					key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
					if m, ok := metricsMap[key]; ok {
						delta := im.extractPodDelta(pod)
						delta.CpuUsageMcores = int64(m.CPUUsagePct)
						delta.MemoryUsageMiB = int64(m.MemoryUsageMb)
						delta.CPUUsagePct = m.CPUUsagePct
						delta.MemoryUsageMb = m.MemoryUsageMb

						dedupKey := fmt.Sprintf("PodMetric/%s/%s", pod.Namespace, pod.Name)
						if im.dedup.ShouldEmit(dedupKey, delta) {
							im.hub.BroadcastEvent(types.EventPodStatusChanged, im.clusterID, delta)
						}
					}
				}
			}
		}
	}
}

