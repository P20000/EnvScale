package k8s

import (
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// GetSnapshot retrieves the complete baseline state of the cluster for WebSocket clients.
func (im *InformerManager) GetSnapshot() (
	pods []types.PodStatusDelta,
	nodes []types.NodeStatusDelta,
	services []types.ServiceStatusDelta,
	deployments []types.DeploymentStatusDelta,
	replicaSets []types.ReplicaSetStatusDelta,
	statefulSets []types.StatefulSetStatusDelta,
	daemonSets []types.DaemonSetStatusDelta,
	ingresses []types.IngressStatusDelta,
	incidents []types.K8sIncidentEvent,
	cronJobs []types.CronJobStatusDelta,
	jobs []types.JobStatusDelta,
	pvcs []types.PVCStatusDelta,
	pvs []types.PVStatusDelta,
	configMaps []types.ConfigMapStatusDelta,
	secrets []types.SecretStatusDelta,
) {
	im.factory.WaitForCacheSync(im.stopCh)
	metricsMap := im.FetchPodMetricsMap()

	podList := im.factory.Core().V1().Pods().Informer().GetStore().List()
	for _, obj := range podList {
		if pod, ok := obj.(*corev1.Pod); ok {
			delta := im.extractPodDelta(pod)
			key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
			if m, ok := metricsMap[key]; ok {
				delta.CpuUsageMcores = int64(m.CPUUsagePct)
				delta.MemoryUsageMiB = int64(m.MemoryUsageMb)
				delta.CPUUsagePct = m.CPUUsagePct
				delta.MemoryUsageMb = m.MemoryUsageMb
			}
			pods = append(pods, delta)
		}
	}

	nodeMetricsMap := im.FetchNodeMetricsMap()
	nodeList := im.factory.Core().V1().Nodes().Informer().GetStore().List()
	for _, obj := range nodeList {
		if node, ok := obj.(*corev1.Node); ok {
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
			}
			if nm, ok := nodeMetricsMap[node.Name]; ok {
				delta.CpuUsageMcores = nm.CpuUsageMcores
				delta.MemoryUsageMiB = nm.MemoryUsageMiB
				delta.CpuPct = nm.CpuPct
				delta.MemoryPct = nm.MemoryPct
			}
			nodes = append(nodes, delta)
		}
	}

	svcList := im.factory.Core().V1().Services().Informer().GetStore().List()
	for _, obj := range svcList {
		if svc, ok := obj.(*corev1.Service); ok {
			ports := make([]int32, len(svc.Spec.Ports))
			for i, p := range svc.Spec.Ports {
				ports[i] = p.Port
			}
			services = append(services, types.ServiceStatusDelta{
				Name:        svc.Name,
				Namespace:   svc.Namespace,
				Type:        string(svc.Spec.Type),
				ClusterIP:   svc.Spec.ClusterIP,
				Selector:    svc.Spec.Selector,
				TargetPorts: ports,
			})
		}
	}

	depList := im.factory.Apps().V1().Deployments().Informer().GetStore().List()
	for _, obj := range depList {
		if dep, ok := obj.(*appsv1.Deployment); ok {
			deployments = append(deployments, im.extractDeploymentDelta(dep))
		}
	}

	rsList := im.factory.Apps().V1().ReplicaSets().Informer().GetStore().List()
	for _, obj := range rsList {
		if rs, ok := obj.(*appsv1.ReplicaSet); ok {
			replicaSets = append(replicaSets, im.extractReplicaSetDelta(rs))
		}
	}

	stsList := im.factory.Apps().V1().StatefulSets().Informer().GetStore().List()
	for _, obj := range stsList {
		if sts, ok := obj.(*appsv1.StatefulSet); ok {
			statefulSets = append(statefulSets, im.extractStatefulSetDelta(sts))
		}
	}

	dsList := im.factory.Apps().V1().DaemonSets().Informer().GetStore().List()
	for _, obj := range dsList {
		if ds, ok := obj.(*appsv1.DaemonSet); ok {
			daemonSets = append(daemonSets, im.extractDaemonSetDelta(ds))
		}
	}

	ingressList := im.factory.Networking().V1().Ingresses().Informer().GetStore().List()
	for _, obj := range ingressList {
		if ing, ok := obj.(*networkingv1.Ingress); ok {
			ingresses = append(ingresses, im.extractIngressDelta(ing))
		}
	}

	evtList := im.factory.Core().V1().Events().Informer().GetStore().List()
	for _, obj := range evtList {
		if evt, ok := obj.(*corev1.Event); ok {
			incidents = append(incidents, im.extractK8sIncidentEvent(evt))
		}
	}

	cjList := im.factory.Batch().V1().CronJobs().Informer().GetStore().List()
	for _, obj := range cjList {
		if cj, ok := obj.(*batchv1.CronJob); ok {
			cronJobs = append(cronJobs, im.extractCronJobDelta(cj))
		}
	}

	jobs = im.getJobsSnapshot()
	pvcs = im.getPVCSnapshot()
	pvs = im.getPVSnapshot()
	configMaps = im.getConfigMapsSnapshot()
	secrets = im.getSecretsSnapshot()

	return pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets
}
