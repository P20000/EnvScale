package k8s

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// InformerManager manages client-go SharedInformerFactory for Pods, Nodes, and Services
type InformerManager struct {
	clientset     kubernetes.Interface
	metricsClient metricsv.Interface
	factory       informers.SharedInformerFactory
	hub           *websocket.Hub
	clusterID     string
	stopCh        chan struct{}
	running       bool
	mu            sync.RWMutex
	dedup         *DedupCache // FNV-hash dedup cache to suppress unchanged delta rebroadcasts
}

// NewInformerManager creates an InformerManager from raw Kubeconfig bytes
func NewInformerManager(kubeconfigBytes []byte, hub *websocket.Hub, clusterID string) (*InformerManager, error) {
	clientConfig, err := clientcmd.NewClientConfigFromBytes(kubeconfigBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse kubeconfig: %w", err)
	}

	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to build rest config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes clientset: %w", err)
	}

	metricsClient, err := metricsv.NewForConfig(restConfig)
	if err != nil {
		log.Printf("[K8s Informer] Warning: failed to initialize versioned K8s metrics clientset for %s: %v", clusterID, err)
	}

	return NewInformerManagerWithClientsets(clientset, metricsClient, hub, clusterID), nil
}

// NewInformerManagerInCluster creates an InformerManager using in-cluster ServiceAccount config
func NewInformerManagerInCluster(hub *websocket.Hub, clusterID string) (*InformerManager, error) {
	restConfig, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to get in-cluster config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create kubernetes clientset: %w", err)
	}

	metricsClient, err := metricsv.NewForConfig(restConfig)
	if err != nil {
		log.Printf("[K8s Informer] Warning: failed to initialize versioned K8s metrics clientset for %s: %v", clusterID, err)
	}

	return NewInformerManagerWithClientsets(clientset, metricsClient, hub, clusterID), nil
}

// NewInformerManagerWithClientset creates an InformerManager using an explicit kubernetes.Interface (useful for fake clientset testing)
func NewInformerManagerWithClientset(clientset kubernetes.Interface, hub *websocket.Hub, clusterID string) *InformerManager {
	return NewInformerManagerWithClientsets(clientset, nil, hub, clusterID)
}

// NewInformerManagerWithClientsets creates an InformerManager using explicit kubernetes and metrics clientsets
func NewInformerManagerWithClientsets(clientset kubernetes.Interface, metricsClient metricsv.Interface, hub *websocket.Hub, clusterID string) *InformerManager {
	factory := informers.NewSharedInformerFactory(clientset, 30*time.Second)

	return &InformerManager{
		clientset:     clientset,
		metricsClient: metricsClient,
		factory:       factory,
		hub:           hub,
		clusterID:     clusterID,
		stopCh:        make(chan struct{}),
		running:       false,
		dedup:         NewDedupCache(),
	}
}

// Start registers Informer handlers and begins watching Pods, Nodes, and Services synchronously
func (im *InformerManager) Start(stopCh <-chan struct{}) {
	im.mu.Lock()
	im.running = true
	im.mu.Unlock()

	podInformer := im.factory.Core().V1().Pods().Informer()
	nodeInformer := im.factory.Core().V1().Nodes().Informer()
	serviceInformer := im.factory.Core().V1().Services().Informer()

	// Pod Event Handlers
	podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if pod, ok := obj.(*corev1.Pod); ok {
				im.emitPodDelta(pod)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if pod, ok := newObj.(*corev1.Pod); ok {
				im.emitPodDelta(pod)
			}
		},
		DeleteFunc: func(obj interface{}) {
			pod := im.resolvePodObject(obj)
			if pod != nil {
				delta := im.extractPodDelta(pod)
				delta.Phase = "Terminated"
				im.dedup.Remove(fmt.Sprintf("Pod/%s/%s", pod.Namespace, pod.Name))
				im.hub.BroadcastEvent(types.EventPodStatusChanged, im.clusterID, delta)
				im.hub.BroadcastEvent(types.EventPodDeleted, im.clusterID, map[string]interface{}{
					"podId":     pod.Name,
					"name":      pod.Name,
					"namespace": pod.Namespace,
				})
			}
		},
	})

	// Node Event Handlers
	nodeInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if node, ok := obj.(*corev1.Node); ok {
				im.emitNodeDelta(node)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if node, ok := newObj.(*corev1.Node); ok {
				im.emitNodeDelta(node)
			}
		},
		DeleteFunc: func(obj interface{}) {
			node := im.resolveNodeObject(obj)
			if node != nil {
				delta := types.NodeStatusDelta{
					Name:   node.Name,
					Status: "Terminated",
					Labels: node.Labels,
				}
				im.hub.BroadcastEvent(types.EventNodeMutated, im.clusterID, delta)
			}
		},
	})

	// Service Event Handlers
	serviceInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if svc, ok := obj.(*corev1.Service); ok {
				im.emitServiceDelta(svc)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if svc, ok := newObj.(*corev1.Service); ok {
				im.emitServiceDelta(svc)
			}
		},
	})

	deploymentInformer := im.factory.Apps().V1().Deployments().Informer()
	deploymentInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if dep, ok := obj.(*appsv1.Deployment); ok {
				im.emitDeploymentDelta(dep)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if dep, ok := newObj.(*appsv1.Deployment); ok {
				im.emitDeploymentDelta(dep)
			}
		},
	})

	replicaSetInformer := im.factory.Apps().V1().ReplicaSets().Informer()
	replicaSetInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if rs, ok := obj.(*appsv1.ReplicaSet); ok {
				im.emitReplicaSetDelta(rs)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if rs, ok := newObj.(*appsv1.ReplicaSet); ok {
				im.emitReplicaSetDelta(rs)
			}
		},
	})

	statefulSetInformer := im.factory.Apps().V1().StatefulSets().Informer()
	statefulSetInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if sts, ok := obj.(*appsv1.StatefulSet); ok {
				im.emitStatefulSetDelta(sts)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if sts, ok := newObj.(*appsv1.StatefulSet); ok {
				im.emitStatefulSetDelta(sts)
			}
		},
	})

	ingressInformer := im.factory.Networking().V1().Ingresses().Informer()
	ingressInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if ing, ok := obj.(*networkingv1.Ingress); ok {
				im.emitIngressDelta(ing)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if ing, ok := newObj.(*networkingv1.Ingress); ok {
				im.emitIngressDelta(ing)
			}
		},
	})

	eventInformer := im.factory.Core().V1().Events().Informer()
	eventInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if evt, ok := obj.(*corev1.Event); ok {
				im.emitK8sIncidentEvent(evt)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if evt, ok := newObj.(*corev1.Event); ok {
				im.emitK8sIncidentEvent(evt)
			}
		},
	})

	im.factory.Start(stopCh)
	go im.startMetricsPulse(stopCh)
	log.Printf("[K8s Informer] Informers started for cluster: %s", im.clusterID)
}

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

// StartAsync starts the informer event loops in a background goroutine using internal stopCh
func (im *InformerManager) StartAsync() {
	im.mu.Lock()
	im.running = true
	im.mu.Unlock()
	go im.Start(im.stopCh)
}

// Stop closes the internal stopCh channel and halts all informer event loops
func (im *InformerManager) Stop() {
	im.mu.Lock()
	defer im.mu.Unlock()

	if !im.running {
		return
	}
	close(im.stopCh)
	im.running = false
	log.Printf("[K8s Informer] Informers stopped for cluster: %s", im.clusterID)
}

// IsRunning returns whether the informer factory is currently active
func (im *InformerManager) IsRunning() bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.running
}

// GetClusterID returns the cluster ID associated with this InformerManager
func (im *InformerManager) GetClusterID() string {
	return im.clusterID
}

// Clientset returns the underlying kubernetes.Interface for this cluster.
// Used by PodLogStreamer to open log stream requests against the same cluster.
func (im *InformerManager) Clientset() kubernetes.Interface {
	return im.clientset
}

func (im *InformerManager) resolvePodObject(obj interface{}) *corev1.Pod {
	if pod, ok := obj.(*corev1.Pod); ok {
		return pod
	}
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		if pod, ok := tombstone.Obj.(*corev1.Pod); ok {
			return pod
		}
	}
	return nil
}

func (im *InformerManager) resolveNodeObject(obj interface{}) *corev1.Node {
	if node, ok := obj.(*corev1.Node); ok {
		return node
	}
	if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
		if node, ok := tombstone.Obj.(*corev1.Node); ok {
			return node
		}
	}
	return nil
}

// PodMetricData encapsulates live CPU and Memory values retrieved from metrics-server
type PodMetricData struct {
	CPUUsagePct   float64
	MemoryUsageMb float64
}

// FetchPodMetricsMap queries the live K8s Metrics API (metrics-server) for all pods
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

// GetSnapshot retrieves the current local cache of all nodes, pods, services, and workloads and formats them as delta events.
func (im *InformerManager) GetSnapshot() (
	pods []types.PodStatusDelta,
	nodes []types.NodeStatusDelta,
	services []types.ServiceStatusDelta,
	deployments []types.DeploymentStatusDelta,
	replicaSets []types.ReplicaSetStatusDelta,
	statefulSets []types.StatefulSetStatusDelta,
	ingresses []types.IngressStatusDelta,
	incidents []types.K8sIncidentEvent,
) {
	// Block until all informer caches are fully synced to prevent returning empty snapshots right after startup
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
			nodes = append(nodes, types.NodeStatusDelta{
				Name:           node.Name,
				Status:         status,
				CPUCapacity:    node.Status.Capacity.Cpu().String(),
				MemoryCapacity: node.Status.Capacity.Memory().String(),
				PodCapacity:    node.Status.Capacity.Pods().Value(),
				Labels:         node.Labels,
			})
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

	return pods, nodes, services, deployments, replicaSets, statefulSets, ingresses, incidents
}

func (im *InformerManager) extractPodDelta(pod *corev1.Pod) types.PodStatusDelta {
	var totalRestarts int32 = 0
	for _, cs := range pod.Status.ContainerStatuses {
		totalRestarts += cs.RestartCount
	}

	phase := string(pod.Status.Phase)
	// Check for specialized failure states like CrashLoopBackOff or OOMKilled
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			phase = cs.State.Waiting.Reason
		} else if cs.State.Running == nil && cs.LastTerminationState.Terminated != nil && cs.LastTerminationState.Terminated.Reason != "" {
			phase = cs.LastTerminationState.Terminated.Reason
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

	// Dedup: skip broadcasting if the pod delta is identical to the last emitted version
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}

	im.hub.BroadcastEvent(types.EventPodStatusChanged, im.clusterID, delta)

	// Anomaly classification: check if the pod's current phase/reason represents
	// a known failure state (OOMKilled, CrashLoopBackOff, ImagePullBackOff, etc.)
	// or if the restart count exceeds the stability threshold.
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

	return types.ReplicaSetStatusDelta{
		Name:          rs.Name,
		Namespace:     rs.Namespace,
		Replicas:      *rs.Spec.Replicas,
		ReadyReplicas: rs.Status.ReadyReplicas,
		OwnerUID:      ownerUID,
		OwnerName:     ownerName,
		OwnerKind:     ownerKind,
		Labels:        rs.Labels,
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
