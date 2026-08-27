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
	dedup         *DedupCache
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

// NewInformerManagerWithClientset creates an InformerManager using an explicit kubernetes.Interface
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
		DeleteFunc: func(obj interface{}) {
			if rs, ok := obj.(*appsv1.ReplicaSet); ok {
				im.emitReplicaSetDeleted(rs)
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

	daemonSetInformer := im.factory.Apps().V1().DaemonSets().Informer()
	daemonSetInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if ds, ok := obj.(*appsv1.DaemonSet); ok {
				im.emitDaemonSetDelta(ds)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if ds, ok := newObj.(*appsv1.DaemonSet); ok {
				im.emitDaemonSetDelta(ds)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if ds, ok := obj.(*appsv1.DaemonSet); ok {
				im.emitDaemonSetDeleted(ds)
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

func (im *InformerManager) StartAsync() {
	im.mu.Lock()
	im.running = true
	im.mu.Unlock()
	go im.Start(im.stopCh)
}

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

func (im *InformerManager) IsRunning() bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.running
}

func (im *InformerManager) GetClusterID() string {
	return im.clusterID
}

func (im *InformerManager) Clientset() kubernetes.Interface {
	return im.clientset
}

type PodMetricData struct {
	CPUUsagePct   float64
	MemoryUsageMb float64
}

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

	return pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents
}
