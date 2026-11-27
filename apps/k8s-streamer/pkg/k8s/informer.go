package k8s

import (
	"fmt"
	"log"
	"sync"
	"sync/atomic"
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

var informerGenSeq atomic.Uint64

// InformerManager manages client-go SharedInformerFactory for Pods, Nodes, and Services
type InformerManager struct {
	clientset       kubernetes.Interface
	streamClientset kubernetes.Interface
	metricsClient   metricsv.Interface
	dynamicClient   dynamic.Interface
	factory         informers.SharedInformerFactory
	hub             *websocket.Hub
	clusterID       string
	generation      uint64
	stopCh          chan struct{}
	stopOnce        sync.Once
	factoryStopCh   chan struct{}
	factoryStopOnce *sync.Once
	readyCh         chan struct{}
	readyOnce       *sync.Once
	reconcileMu     sync.Mutex
	started         bool
	stopped         bool
	running         bool
	mu              sync.RWMutex
	dedup           *DedupCache
	metricsHistory  []types.ClusterMetricPoint
	metricsMu       sync.RWMutex
	watchSecrets    bool
	metricsAllowed  *bool
	allowedResources    map[string]bool
	registeredResources map[string]bool
	activeResources     map[string]bool
	syncedByKey         map[string]cache.InformerSynced
	lastSyncAt          time.Time
	vsInformer          cache.SharedIndexInformer
	vscInformer         cache.SharedIndexInformer
}

// NewInformerManager creates an InformerManager from raw Kubeconfig bytes
func NewInformerManager(kubeconfigBytes []byte, hub *websocket.Hub, clusterID string) (*InformerManager, error) {
	if err := ValidateKubeconfigSecurity(kubeconfigBytes); err != nil {
		return nil, err
	}

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
	if err != nil {
		return nil, fmt.Errorf("failed to build kubernetes client: %w", err)
	}

	if _, pingErr := clientset.Discovery().ServerVersion(); pingErr != nil {
		return nil, fmt.Errorf("cluster API server unreachable or TLS verification failed: %w", pingErr)
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
		clientset:           clientset,
		metricsClient:       metricsClient,
		factory:             factory,
		hub:                 hub,
		clusterID:           clusterID,
		generation:          informerGenSeq.Add(1),
		stopCh:              make(chan struct{}),
		factoryStopCh:       make(chan struct{}),
		factoryStopOnce:     &sync.Once{},
		readyCh:             make(chan struct{}),
		readyOnce:           &sync.Once{},
		running:             false,
		dedup:               NewDedupCache(),
		registeredResources: make(map[string]bool),
		activeResources:     make(map[string]bool),
		syncedByKey:         make(map[string]cache.InformerSynced),
	}
}

// Start registers Informer handlers and begins watching permitted resources.
func (im *InformerManager) Start(stopCh <-chan struct{}) {
	im.reconcileMu.Lock()
	defer im.reconcileMu.Unlock()

	im.mu.Lock()
	if im.stopped || im.started {
		im.mu.Unlock()
		return
	}
	im.started = true
	im.running = true
	readyOnce := im.readyOnce
	readyCh := im.readyCh
	mgrStopCh := im.stopCh
	im.mu.Unlock()

	if stopCh != nil && stopCh != mgrStopCh {
		go func() {
			select {
			case <-stopCh:
				im.Stop()
			case <-mgrStopCh:
			}
		}()
	}

	im.registerAllowedInformers()
	if readyOnce != nil {
		readyOnce.Do(func() { close(readyCh) })
	}

	if im.IsStopped() {
		return
	}

	if f := im.currentFactory(); f != nil {
		f.Start(im.currentFactoryStopCh())
	}
	go im.startMetricsPulse(mgrStopCh)
	log.Printf("[K8s Informer] Informers started for cluster: %s", im.clusterID)
}

func (im *InformerManager) registerAllowedInformers() {
	f := im.currentFactory()
	if f == nil {
		return
	}
	if im.shouldRegisterInformer("core/v1/pods") {
		podInformer := f.Core().V1().Pods().Informer()
		im.recordInformer("core/v1/pods", podInformer)
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
	}

	if im.shouldRegisterInformer("core/v1/nodes") {
		nodeInformer := f.Core().V1().Nodes().Informer()
		im.recordInformer("core/v1/nodes", nodeInformer)
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
	}

	if im.shouldRegisterInformer("core/v1/services") {
		serviceInformer := f.Core().V1().Services().Informer()
		im.recordInformer("core/v1/services", serviceInformer)
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
	}

	if im.shouldRegisterInformer("apps/v1/deployments") {
		deploymentInformer := f.Apps().V1().Deployments().Informer()
		im.recordInformer("apps/v1/deployments", deploymentInformer)
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
	}

	if im.shouldRegisterInformer("apps/v1/replicasets") {
		replicaSetInformer := f.Apps().V1().ReplicaSets().Informer()
		im.recordInformer("apps/v1/replicasets", replicaSetInformer)
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
	}

	if im.shouldRegisterInformer("apps/v1/statefulsets") {
		statefulSetInformer := f.Apps().V1().StatefulSets().Informer()
		im.recordInformer("apps/v1/statefulsets", statefulSetInformer)
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
	}

	if im.shouldRegisterInformer("networking.k8s.io/v1/ingresses") {
		ingressInformer := f.Networking().V1().Ingresses().Informer()
		im.recordInformer("networking.k8s.io/v1/ingresses", ingressInformer)
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
	}

	if im.shouldRegisterInformer("core/v1/events") {
		eventInformer := f.Core().V1().Events().Informer()
		im.recordInformer("core/v1/events", eventInformer)
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
	}

	if im.shouldRegisterInformer("apps/v1/daemonsets") {
		daemonSetInformer := f.Apps().V1().DaemonSets().Informer()
		im.recordInformer("apps/v1/daemonsets", daemonSetInformer)
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
	}

	if im.shouldRegisterInformer("batch/v1/cronjobs") {
		cronJobInformer := f.Batch().V1().CronJobs().Informer()
		im.recordInformer("batch/v1/cronjobs", cronJobInformer)
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
	}

	im.setupJobInformer()
	im.setupStorageInformers()
	im.setupConfigInformers()
	im.setupPolicyHPAInformers()
	im.setupPDBInformers()
	im.setupQuotaInformers()
	im.setupSnapshotInformers()
	im.setupRBACInformers()
}

func (im *InformerManager) StartAsync() {
	im.reconcileMu.Lock()
	defer im.reconcileMu.Unlock()

	im.mu.Lock()
	if im.stopped || im.started {
		im.mu.Unlock()
		return
	}
	im.started = true
	im.running = true
	readyOnce := im.readyOnce
	readyCh := im.readyCh
	im.mu.Unlock()

	// Populate permitted informers synchronously before returning so concurrent
	// snapshots cannot observe an empty/partial registration window.
	im.registerAllowedInformers()
	if readyOnce != nil {
		readyOnce.Do(func() { close(readyCh) })
	}

	go func() {
		if im.IsStopped() {
			return
		}
		if f := im.currentFactory(); f != nil {
			f.Start(im.currentFactoryStopCh())
		}
		go im.startMetricsPulse(im.stopCh)
		log.Printf("[K8s Informer] Informers started for cluster: %s", im.clusterID)
	}()
}

func (im *InformerManager) Stop() {
	im.mu.Lock()
	wasRunning := im.running
	im.stopped = true
	im.running = false
	fStopCh := im.factoryStopCh
	fStopOnce := im.factoryStopOnce
	readyCh := im.readyCh
	readyOnce := im.readyOnce
	im.mu.Unlock()

	im.stopOnce.Do(func() {
		close(im.stopCh)
	})
	if fStopOnce != nil && fStopCh != nil {
		fStopOnce.Do(func() {
			close(fStopCh)
		})
	}
	if readyOnce != nil && readyCh != nil {
		readyOnce.Do(func() {
			close(readyCh)
		})
	}
	if wasRunning {
		log.Printf("[K8s Informer] Informers stopped for cluster: %s", im.clusterID)
	}
}

func (im *InformerManager) IsRunning() bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.running && !im.stopped
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

