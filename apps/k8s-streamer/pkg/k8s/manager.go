package k8s

import (
	"fmt"
	"log"
	"sync"

	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// ClusterManager maintains a dynamic, thread-safe registry of InformerManager instances keyed by cluster/workspace ID.
type ClusterManager struct {
	clusters map[string]*InformerManager
	hub      *websocket.Hub
	mu       sync.RWMutex
}

// NewClusterManager creates a new ClusterManager registry instance
func NewClusterManager(hub *websocket.Hub) *ClusterManager {
	return &ClusterManager{
		clusters: make(map[string]*InformerManager),
		hub:      hub,
	}
}

// RegisterCluster parses raw Kubeconfig bytes, instantiates an InformerManager, and starts informers asynchronously.
func (cm *ClusterManager) RegisterCluster(clusterID string, kubeconfigBytes []byte) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if existing, ok := cm.clusters[clusterID]; ok {
		if existing.IsRunning() {
			log.Printf("[ClusterManager] Cluster %s is already registered and running", clusterID)
			return nil
		}
		existing.Stop()
		delete(cm.clusters, clusterID)
	}

	im, err := NewInformerManager(kubeconfigBytes, cm.hub, clusterID)
	if err != nil {
		return fmt.Errorf("failed to register cluster %s: %w", clusterID, err)
	}

	im.StartAsync()
	cm.clusters[clusterID] = im
	log.Printf("[ClusterManager] Successfully registered and started cluster informers for: %s", clusterID)
	return nil
}

// RegisterInCluster creates and starts an InformerManager using in-cluster ServiceAccount config.
func (cm *ClusterManager) RegisterInCluster(clusterID string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if existing, ok := cm.clusters[clusterID]; ok {
		if existing.IsRunning() {
			log.Printf("[ClusterManager] In-cluster %s is already registered and running", clusterID)
			return nil
		}
		existing.Stop()
		delete(cm.clusters, clusterID)
	}

	im, err := NewInformerManagerInCluster(cm.hub, clusterID)
	if err != nil {
		return fmt.Errorf("failed to register in-cluster %s: %w", clusterID, err)
	}

	im.StartAsync()
	cm.clusters[clusterID] = im
	log.Printf("[ClusterManager] Successfully registered in-cluster informers for: %s", clusterID)
	return nil
}

// RegisterWithClientset registers an InformerManager with a pre-configured clientset (for testing/fake clientset use).
func (cm *ClusterManager) RegisterWithClientset(clusterID string, clientset kubernetes.Interface) *InformerManager {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if existing, ok := cm.clusters[clusterID]; ok {
		existing.Stop()
		delete(cm.clusters, clusterID)
	}

	im := NewInformerManagerWithClientset(clientset, cm.hub, clusterID)
	im.StartAsync()
	cm.clusters[clusterID] = im
	return im
}

// UnregisterCluster stops informers for the specified cluster and removes it from the registry.
func (cm *ClusterManager) UnregisterCluster(clusterID string) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	im, ok := cm.clusters[clusterID]
	if !ok {
		return fmt.Errorf("cluster %s is not registered", clusterID)
	}

	im.Stop()
	delete(cm.clusters, clusterID)
	log.Printf("[ClusterManager] Unregistered and stopped informers for cluster: %s", clusterID)
	return nil
}

// GetClusterSnapshot retrieves the current cached state of pods, nodes, services, and workloads for a given cluster.
func (cm *ClusterManager) GetClusterSnapshot(clusterID string) (
	[]types.PodStatusDelta,
	[]types.NodeStatusDelta,
	[]types.ServiceStatusDelta,
	[]types.DeploymentStatusDelta,
	[]types.ReplicaSetStatusDelta,
	[]types.StatefulSetStatusDelta,
	[]types.IngressStatusDelta,
	error,
) {
	cm.mu.RLock()
	im, ok := cm.clusters[clusterID]
	cm.mu.RUnlock()

	if !ok {
		return nil, nil, nil, nil, nil, nil, nil, fmt.Errorf("cluster %s not found", clusterID)
	}
	pods, nodes, services, deployments, replicaSets, statefulSets, ingresses := im.GetSnapshot()
	return pods, nodes, services, deployments, replicaSets, statefulSets, ingresses, nil
}

// GetCluster returns the InformerManager associated with the given clusterID.
func (cm *ClusterManager) GetCluster(clusterID string) (*InformerManager, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	im, ok := cm.clusters[clusterID]
	return im, ok
}

// ListClusters returns a map of cluster IDs and their running status.
func (cm *ClusterManager) ListClusters() map[string]bool {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	result := make(map[string]bool, len(cm.clusters))
	for id, im := range cm.clusters {
		result[id] = im.IsRunning()
	}
	return result
}

// ActiveClusterCount returns the total number of registered clusters.
func (cm *ClusterManager) ActiveClusterCount() int {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return len(cm.clusters)
}

// ShutdownAll gracefully stops all active cluster informers.
func (cm *ClusterManager) ShutdownAll() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	log.Printf("[ClusterManager] Shutting down all %d active cluster informers...", len(cm.clusters))
	for id, im := range cm.clusters {
		im.Stop()
		delete(cm.clusters, id)
	}
	log.Println("[ClusterManager] All cluster informers successfully shut down.")
}
