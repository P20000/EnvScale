package k8s

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/tools/clientcmd"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
	_ "k8s.io/client-go/plugin/pkg/client/auth"
)

// InformerManager manages client-go SharedInformerFactory for Pods, Nodes, and Services
type InformerManager struct {
	clientset       kubernetes.Interface
	streamClientset kubernetes.Interface
	metricsClient   metricsv.Interface
	dynamicClient   dynamic.Interface
	factory         informers.SharedInformerFactory
	hub             *websocket.Hub
	clusterID       string
	stopCh          chan struct{}
	running         bool
	mu              sync.RWMutex
	dedup           *DedupCache
	metricsHistory  []types.ClusterMetricPoint
	metricsMu       sync.RWMutex
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

	restConfig.Timeout = 4 * time.Second
	clientset, err := kubernetes.NewForConfig(restConfig)
	var pingErr error
	if err == nil {
		_, pingErr = clientset.Discovery().ServerVersion()
	} else {
		pingErr = err
	}

	if pingErr != nil && (strings.Contains(pingErr.Error(), "x509") || strings.Contains(pingErr.Error(), "unknown authority") || strings.Contains(pingErr.Error(), "verification error")) {
		log.Printf("[K8s Informer] Self-signed TLS CA detected for cluster %s (%v). Retrying with Insecure=true fallback...", clusterID, pingErr)
		restConfig.Insecure = true
		restConfig.CAData = nil
		restConfig.CAFile = ""
		if cs, err2 := kubernetes.NewForConfig(restConfig); err2 == nil {
			if _, err3 := cs.Discovery().ServerVersion(); err3 == nil {
				clientset = cs
				pingErr = nil
			}
		}
	}

	if pingErr != nil {
		return nil, fmt.Errorf("cluster API server unreachable: %w", pingErr)
	}

	metricsClient, err := metricsv.NewForConfig(restConfig)
	if err != nil {
		log.Printf("[K8s Informer] Warning: failed to initialize versioned K8s metrics clientset for %s: %v", clusterID, err)
	}

	dynClient, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		log.Printf("[K8s Informer] Warning: failed to initialize dynamic clientset for %s: %v", clusterID, err)
	}

	streamConfig := rest.CopyConfig(restConfig)
	streamConfig.Timeout = 0
	streamClientset, _ := kubernetes.NewForConfig(streamConfig)

	mgr := NewInformerManagerWithClientsets(clientset, metricsClient, hub, clusterID)
	mgr.dynamicClient = dynClient
	mgr.streamClientset = streamClientset
	return mgr, nil
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

	dynClient, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		log.Printf("[K8s Informer] Warning: failed to initialize dynamic clientset for %s: %v", clusterID, err)
	}

	streamConfig := rest.CopyConfig(restConfig)
	streamConfig.Timeout = 0
	streamClientset, _ := kubernetes.NewForConfig(streamConfig)

	mgr := NewInformerManagerWithClientsets(clientset, metricsClient, hub, clusterID)
	mgr.dynamicClient = dynClient
	mgr.streamClientset = streamClientset
	return mgr, nil
}

// NewInformerManagerWithClientset creates an InformerManager using an explicit kubernetes.Interface
func NewInformerManagerWithClientset(clientset kubernetes.Interface, hub *websocket.Hub, clusterID string) *InformerManager {
	return NewInformerManagerWithClientsets(clientset, nil, hub, clusterID)
}

// SetDynamicClient injects an explicit dynamic.Interface (used for testing and dynamic CRD mocks)
func (im *InformerManager) SetDynamicClient(dyn dynamic.Interface) {
	im.dynamicClient = dyn
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
		DeleteFunc: func(obj interface{}) {
			if sts, ok := obj.(*appsv1.StatefulSet); ok {
				im.emitStatefulSetDeleted(sts)
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

	cronJobInformer := im.factory.Batch().V1().CronJobs().Informer()
	cronJobInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if cj, ok := obj.(*batchv1.CronJob); ok {
				im.emitCronJobDelta(cj)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if cj, ok := newObj.(*batchv1.CronJob); ok {
				im.emitCronJobDelta(cj)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if cj, ok := obj.(*batchv1.CronJob); ok {
				im.emitCronJobDeleted(cj)
			}
		},
	})

	im.setupJobInformer()
	im.setupStorageInformers()
	im.setupConfigInformers()
	im.setupPolicyHPAInformers()
	im.setupPDBInformers()
	im.setupQuotaInformers()
	im.setupSnapshotInformers()

	im.factory.Start(stopCh)
	go im.startMetricsPulse(stopCh)
	log.Printf("[K8s Informer] Informers started for cluster: %s", im.clusterID)
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

// StreamClientset returns a Kubernetes clientset configured with Timeout=0 for persistent streaming
func (im *InformerManager) StreamClientset() kubernetes.Interface {
	if im.streamClientset != nil {
		return im.streamClientset
	}
	return im.clientset
}

