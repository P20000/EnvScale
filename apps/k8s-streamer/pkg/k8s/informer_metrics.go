package k8s

import (
	"context"
	"fmt"
	"math"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

type PodMetricData struct {
	CPUUsagePct   float64
	MemoryUsageMb float64
}

type NodeMetricData struct {
	CpuUsageMcores int64
	MemoryUsageMiB int64
	CpuPct         float64
	MemoryPct      float64
}

// FetchNodeMetricsMap fetches real-time node metrics from metrics-server clientset
func (im *InformerManager) FetchNodeMetricsMap() map[string]NodeMetricData {
	metricsMap := make(map[string]NodeMetricData)
	if im.metricsClient == nil {
		return metricsMap
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	nodeMetricsList, err := im.metricsClient.MetricsV1beta1().NodeMetricses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return metricsMap
	}

	for _, nm := range nodeMetricsList.Items {
		cpuMilli := nm.Usage.Cpu().MilliValue()
		memBytes := nm.Usage.Memory().Value()
		memMiB := memBytes / (1024 * 1024)

		var cpuPct float64 = 0
		var memPct float64 = 0

		if nodeObj, exists, _ := im.factory.Core().V1().Nodes().Informer().GetStore().GetByKey(nm.Name); exists {
			if node, ok := nodeObj.(*corev1.Node); ok {
				allocatableCpu := node.Status.Allocatable.Cpu().MilliValue()
				if allocatableCpu > 0 {
					cpuPct = math.Min(100, math.Max(0, (float64(cpuMilli)/float64(allocatableCpu))*100))
				}
				allocatableMem := node.Status.Allocatable.Memory().Value()
				if allocatableMem > 0 {
					memPct = math.Min(100, math.Max(0, (float64(memBytes)/float64(allocatableMem))*100))
				}
			}
		}

		metricsMap[nm.Name] = NodeMetricData{
			CpuUsageMcores: cpuMilli,
			MemoryUsageMiB: memMiB,
			CpuPct:         math.Round(cpuPct*10) / 10,
			MemoryPct:      math.Round(memPct*10) / 10,
		}
	}
	return metricsMap
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

// recordClusterMetric appends a new metric point to the rolling 60s history buffer
func (im *InformerManager) recordClusterMetric(point types.ClusterMetricPoint) {
	im.metricsMu.Lock()
	defer im.metricsMu.Unlock()
	im.metricsHistory = append(im.metricsHistory, point)
	if len(im.metricsHistory) > 60 {
		im.metricsHistory = im.metricsHistory[len(im.metricsHistory)-60:]
	}
}

// GetMetricsHistory retrieves a copy of the rolling 60-second metric points
func (im *InformerManager) GetMetricsHistory() []types.ClusterMetricPoint {
	im.metricsMu.RLock()
	defer im.metricsMu.RUnlock()
	if len(im.metricsHistory) == 0 {
		return []types.ClusterMetricPoint{}
	}
	res := make([]types.ClusterMetricPoint, len(im.metricsHistory))
	copy(res, im.metricsHistory)
	return res
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

			var clusterTotalMcores float64
			var clusterTotalMemoryMb float64
			for _, m := range metricsMap {
				clusterTotalMcores += m.CPUUsagePct
				clusterTotalMemoryMb += m.MemoryUsageMb
			}

			var totalCapMcores float64
			var totalCapMemoryMb float64
			nodeList := im.factory.Core().V1().Nodes().Informer().GetStore().List()
			for _, obj := range nodeList {
				if node, ok := obj.(*corev1.Node); ok {
					totalCapMcores += float64(node.Status.Allocatable.Cpu().MilliValue())
					totalCapMemoryMb += float64(node.Status.Allocatable.Memory().Value()) / (1024 * 1024)
				}
			}
			if totalCapMcores == 0 {
				totalCapMcores = 2000
			}
			if totalCapMemoryMb == 0 {
				totalCapMemoryMb = 4096
			}
			cpuPct := math.Min(100, math.Max(0, (clusterTotalMcores/totalCapMcores)*100))
			memPct := math.Min(100, math.Max(0, (clusterTotalMemoryMb/totalCapMemoryMb)*100))

			metricPoint := types.ClusterMetricPoint{
				Timestamp: time.Now().UnixMilli(),
				CpuPct:    cpuPct,
				MemoryPct: memPct,
			}
			im.recordClusterMetric(metricPoint)
			im.hub.BroadcastEvent(types.EventClusterMetrics, im.clusterID, metricPoint)

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

			// Broadcast live real node metrics
			nodeMetricsMap := im.FetchNodeMetricsMap()
			if len(nodeMetricsMap) > 0 {
				for _, obj := range nodeList {
					if node, ok := obj.(*corev1.Node); ok {
						if nm, ok := nodeMetricsMap[node.Name]; ok {
							status := "Unknown"
							for _, cond := range node.Status.Conditions {
								if cond.Type == corev1.NodeReady {
									if cond.Status == corev1.ConditionTrue {
										status = "Ready"
									} else {
										status = "NotReady"
									}
								}
							}
							delta := types.NodeStatusDelta{
								Name:           node.Name,
								Status:         status,
								CPUCapacity:    node.Status.Capacity.Cpu().String(),
								MemoryCapacity: node.Status.Capacity.Memory().String(),
								PodCapacity:    node.Status.Capacity.Pods().Value(),
								Labels:         node.Labels,
								CpuUsageMcores: nm.CpuUsageMcores,
								MemoryUsageMiB: nm.MemoryUsageMiB,
								CpuPct:         nm.CpuPct,
								MemoryPct:      nm.MemoryPct,
							}
							dedupKey := fmt.Sprintf("NodeMetric/%s", node.Name)
							if im.dedup.ShouldEmit(dedupKey, delta) {
								im.hub.BroadcastEvent(types.EventNodeMutated, im.clusterID, delta)
							}
						}
					}
				}
			}
		}
	}
}

