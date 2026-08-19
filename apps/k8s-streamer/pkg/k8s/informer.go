package k8s

import (
	"fmt"
	"log"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// InformerManager manages client-go SharedInformerFactory for Pods, Nodes, and Services
type InformerManager struct {
	clientset kubernetes.Interface
	factory   informers.SharedInformerFactory
	hub       *websocket.Hub
	clusterID string
	stopCh    chan struct{}
	running   bool
	mu        sync.RWMutex
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

	return NewInformerManagerWithClientset(clientset, hub, clusterID), nil
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

	return NewInformerManagerWithClientset(clientset, hub, clusterID), nil
}

// NewInformerManagerWithClientset creates an InformerManager using an explicit kubernetes.Interface (useful for fake clientset testing)
func NewInformerManagerWithClientset(clientset kubernetes.Interface, hub *websocket.Hub, clusterID string) *InformerManager {
	factory := informers.NewSharedInformerFactory(clientset, 30*time.Second)

	return &InformerManager{
		clientset: clientset,
		factory:   factory,
		hub:       hub,
		clusterID: clusterID,
		stopCh:    make(chan struct{}),
		running:   false,
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
				delta.Phase = "Failed" // Mark as terminated
				im.hub.BroadcastEvent(types.EventPodStatusChanged, im.clusterID, delta)
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

	im.factory.Start(stopCh)
	log.Printf("[K8s Informer] Informers started for cluster: %s", im.clusterID)
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
		} else if cs.LastTerminationState.Terminated != nil && cs.LastTerminationState.Terminated.Reason != "" {
			phase = cs.LastTerminationState.Terminated.Reason
		}
	}

	return types.PodStatusDelta{
		Name:         pod.Name,
		Namespace:    pod.Namespace,
		NodeName:     pod.Spec.NodeName,
		Phase:        phase,
		RestartCount: totalRestarts,
		Labels:       pod.Labels,
		CreatedAt:    pod.CreationTimestamp.Time,
	}
}

func (im *InformerManager) emitPodDelta(pod *corev1.Pod) {
	delta := im.extractPodDelta(pod)
	im.hub.BroadcastEvent(types.EventPodStatusChanged, im.clusterID, delta)
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
	im.hub.BroadcastEvent(types.EventServiceMutated, im.clusterID, delta)
}

