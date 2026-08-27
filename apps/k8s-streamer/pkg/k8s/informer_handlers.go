package k8s

import (
	"fmt"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

func (im *InformerManager) resolvePodObject(obj interface{}) *corev1.Pod {
	if pod, ok := obj.(*corev1.Pod); ok {
		return pod
	}
	return nil
}

func (im *InformerManager) resolveNodeObject(obj interface{}) *corev1.Node {
	if node, ok := obj.(*corev1.Node); ok {
		return node
	}
	return nil
}

func (im *InformerManager) extractPodDelta(pod *corev1.Pod) types.PodStatusDelta {
	var totalRestarts int32 = 0
	for _, cs := range pod.Status.ContainerStatuses {
		totalRestarts += cs.RestartCount
	}

	phase := string(pod.Status.Phase)
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" {
			phase = cs.State.Terminated.Reason
		} else if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			phase = cs.State.Waiting.Reason
		}
	}

	var ownerUID, ownerName, ownerKind string
	if len(pod.OwnerReferences) > 0 {
		ownerUID = string(pod.OwnerReferences[0].UID)
		ownerName = pod.OwnerReferences[0].Name
		ownerKind = pod.OwnerReferences[0].Kind
	}

	return types.PodStatusDelta{
		Name:         pod.Name,
		Namespace:    pod.Namespace,
		NodeName:     pod.Spec.NodeName,
		PodIP:        pod.Status.PodIP,
		Phase:        phase,
		RestartCount: totalRestarts,
		Labels:       pod.Labels,
		OwnerUID:     ownerUID,
		OwnerName:    ownerName,
		OwnerKind:    ownerKind,
		CreatedAt:    pod.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) emitPodDelta(pod *corev1.Pod) {
	delta := im.extractPodDelta(pod)

	metricsMap := im.FetchPodMetricsMap()
	key := fmt.Sprintf("%s/%s", pod.Namespace, pod.Name)
	if m, ok := metricsMap[key]; ok {
		delta.CpuUsageMcores = int64(m.CPUUsagePct)
		delta.MemoryUsageMiB = int64(m.MemoryUsageMb)
		delta.CPUUsagePct = m.CPUUsagePct
		delta.MemoryUsageMb = m.MemoryUsageMb
	}

	if !im.dedup.ShouldEmit(key, delta) {
		return
	}

	im.hub.BroadcastEvent(types.EventPodStatusChanged, im.clusterID, delta)

	if match := ClassifyPodAnomaly(delta.Phase, delta.RestartCount); match != nil {
		im.hub.BroadcastEvent(types.EventPodAnomalyDetected, im.clusterID, types.PodAnomalyEvent{
			PodName:     delta.Name,
			Namespace:   delta.Namespace,
			AnomalyType: match.AnomalyType,
			Severity:    match.Severity,
			Message:     match.Message,
			Source:      "informer",
			Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		})
	}
}

func (im *InformerManager) emitNodeDelta(node *corev1.Node) {
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

	key := fmt.Sprintf("Node/%s", node.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventNodeMutated, im.clusterID, delta)
}

func (im *InformerManager) emitServiceDelta(svc *corev1.Service) {
	ports := make([]int32, len(svc.Spec.Ports))
	for i, p := range svc.Spec.Ports {
		ports[i] = p.Port
	}

	delta := types.ServiceStatusDelta{
		Name:        svc.Name,
		Namespace:   svc.Namespace,
		Type:        string(svc.Spec.Type),
		ClusterIP:   svc.Spec.ClusterIP,
		Selector:    svc.Spec.Selector,
		TargetPorts: ports,
	}

	key := fmt.Sprintf("Service/%s/%s", svc.Namespace, svc.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventServiceMutated, im.clusterID, delta)
}

func (im *InformerManager) extractDeploymentDelta(dep *appsv1.Deployment) types.DeploymentStatusDelta {
	return types.DeploymentStatusDelta{
		Name:          dep.Name,
		Namespace:     dep.Namespace,
		Replicas:      *dep.Spec.Replicas,
		ReadyReplicas: dep.Status.ReadyReplicas,
		Selector:      dep.Spec.Selector.MatchLabels,
		Labels:        dep.Labels,
	}
}

func (im *InformerManager) emitDeploymentDelta(dep *appsv1.Deployment) {
	delta := im.extractDeploymentDelta(dep)
	key := fmt.Sprintf("Deployment/%s/%s", dep.Namespace, dep.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventDeploymentMutated, im.clusterID, delta)
}

func (im *InformerManager) extractReplicaSetDelta(rs *appsv1.ReplicaSet) types.ReplicaSetStatusDelta {
	var ownerUID, ownerName, ownerKind string
	if len(rs.OwnerReferences) > 0 {
		ownerUID = string(rs.OwnerReferences[0].UID)
		ownerName = rs.OwnerReferences[0].Name
		ownerKind = rs.OwnerReferences[0].Kind
	}

	var images []string
	for _, c := range rs.Spec.Template.Spec.Containers {
		if c.Image != "" {
			images = append(images, c.Image)
		}
	}

	revision := ""
	if rs.Annotations != nil {
		revision = rs.Annotations["deployment.kubernetes.io/revision"]
	}

	var replicas int32
	if rs.Spec.Replicas != nil {
		replicas = *rs.Spec.Replicas
	}

	return types.ReplicaSetStatusDelta{
		Name:          rs.Name,
		Namespace:     rs.Namespace,
		Replicas:      replicas,
		ReadyReplicas: rs.Status.ReadyReplicas,
		OwnerUID:      ownerUID,
		OwnerName:     ownerName,
		OwnerKind:     ownerKind,
		Labels:        rs.Labels,
		Revision:      revision,
		Images:        images,
		CreatedAt:     rs.CreationTimestamp.Time,
	}
}

func (im *InformerManager) emitReplicaSetDelta(rs *appsv1.ReplicaSet) {
	delta := im.extractReplicaSetDelta(rs)
	key := fmt.Sprintf("ReplicaSet/%s/%s", rs.Namespace, rs.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventReplicaSetMutated, im.clusterID, delta)
}

func (im *InformerManager) emitReplicaSetDeleted(rs *appsv1.ReplicaSet) {
	delta := im.extractReplicaSetDelta(rs)
	im.hub.BroadcastEvent(types.EventReplicaSetDeleted, im.clusterID, delta)
}

func (im *InformerManager) extractStatefulSetDelta(sts *appsv1.StatefulSet) types.StatefulSetStatusDelta {
	return types.StatefulSetStatusDelta{
		Name:          sts.Name,
		Namespace:     sts.Namespace,
		Replicas:      *sts.Spec.Replicas,
		ReadyReplicas: sts.Status.ReadyReplicas,
		Selector:      sts.Spec.Selector.MatchLabels,
		Labels:        sts.Labels,
	}
}

func (im *InformerManager) emitStatefulSetDelta(sts *appsv1.StatefulSet) {
	delta := im.extractStatefulSetDelta(sts)
	key := fmt.Sprintf("StatefulSet/%s/%s", sts.Namespace, sts.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventStatefulSetMutated, im.clusterID, delta)
}

func (im *InformerManager) extractIngressDelta(ing *networkingv1.Ingress) types.IngressStatusDelta {
	rules := make([]types.IngressRuleStatus, 0)
	for _, rule := range ing.Spec.Rules {
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				var svcName string
				var svcPort int32
				if path.Backend.Service != nil {
					svcName = path.Backend.Service.Name
					if path.Backend.Service.Port.Number != 0 {
						svcPort = path.Backend.Service.Port.Number
					}
				}
				rules = append(rules, types.IngressRuleStatus{
					Host:        rule.Host,
					Path:        path.Path,
					ServiceName: svcName,
					ServicePort: svcPort,
				})
			}
		}
	}

	var ingClass string
	if ing.Spec.IngressClassName != nil {
		ingClass = *ing.Spec.IngressClassName
	}

	tlsList := make([]types.IngressTLSStatus, 0)
	for _, t := range ing.Spec.TLS {
		tlsList = append(tlsList, types.IngressTLSStatus{
			Hosts:      t.Hosts,
			SecretName: t.SecretName,
		})
	}

	lbIPs := make([]string, 0)
	for _, ingStatus := range ing.Status.LoadBalancer.Ingress {
		if ingStatus.IP != "" {
			lbIPs = append(lbIPs, ingStatus.IP)
		} else if ingStatus.Hostname != "" {
			lbIPs = append(lbIPs, ingStatus.Hostname)
		}
	}

	return types.IngressStatusDelta{
		Name:             ing.Name,
		Namespace:        ing.Namespace,
		IngressClassName: ingClass,
		Rules:            rules,
		TLS:              tlsList,
		LoadBalancerIPs:  lbIPs,
		Labels:           ing.Labels,
	}
}

func (im *InformerManager) emitIngressDelta(ing *networkingv1.Ingress) {
	delta := im.extractIngressDelta(ing)
	key := fmt.Sprintf("Ingress/%s/%s", ing.Namespace, ing.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventIngressMutated, im.clusterID, delta)
}

func (im *InformerManager) emitK8sIncidentEvent(evt *corev1.Event) {
	incident := im.extractK8sIncidentEvent(evt)
	key := fmt.Sprintf("Event/%s/%s", evt.Namespace, evt.UID)
	if !im.dedup.ShouldEmit(key, incident) {
		return
	}
	im.hub.BroadcastEvent(types.EventK8sIncidentCreated, im.clusterID, incident)
}

func (im *InformerManager) extractK8sIncidentEvent(evt *corev1.Event) types.K8sIncidentEvent {
	timestamp := evt.FirstTimestamp.Time
	if timestamp.IsZero() {
		timestamp = evt.CreationTimestamp.Time
	}
	if timestamp.IsZero() {
		timestamp = time.Now()
	}
	timestamp = timestamp.UTC()

	targetPod := evt.InvolvedObject.Name
	if targetPod == "" {
		targetPod = evt.Name
	}

	return types.K8sIncidentEvent{
		EventID:      string(evt.UID),
		Reason:       evt.Reason,
		Message:      evt.Message,
		TargetPod:    targetPod,
		Namespace:    evt.Namespace,
		Cluster:      im.clusterID,
		SeverityType: evt.Type,
		Timestamp:    timestamp,
	}
}

func (im *InformerManager) extractDaemonSetDelta(ds *appsv1.DaemonSet) types.DaemonSetStatusDelta {
	images := make([]string, 0)
	for _, c := range ds.Spec.Template.Spec.Containers {
		images = append(images, c.Image)
	}

	return types.DaemonSetStatusDelta{
		Name:                   ds.Name,
		Namespace:              ds.Namespace,
		DesiredNumberScheduled: ds.Status.DesiredNumberScheduled,
		CurrentNumberScheduled: ds.Status.CurrentNumberScheduled,
		NumberReady:            ds.Status.NumberReady,
		NumberUnavailable:      ds.Status.NumberUnavailable,
		Images:                 images,
		Labels:                 ds.Labels,
		CreatedAt:              ds.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) emitDaemonSetDelta(ds *appsv1.DaemonSet) {
	delta := im.extractDaemonSetDelta(ds)
	key := fmt.Sprintf("DaemonSet/%s/%s", ds.Namespace, ds.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventDaemonSetMutated, im.clusterID, delta)
}

func (im *InformerManager) emitDaemonSetDeleted(ds *appsv1.DaemonSet) {
	delta := im.extractDaemonSetDelta(ds)
	im.hub.BroadcastEvent(types.EventDaemonSetDeleted, im.clusterID, delta)
}
