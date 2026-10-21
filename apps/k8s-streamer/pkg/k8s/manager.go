package k8s

import (
	"fmt"
	"log"
	"strings"
	"sync"

	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// ClusterManager maintains a dynamic, thread-safe registry of InformerManager instances keyed by cluster/workspace ID.
type ClusterManager struct {
	clusters      map[string]*InformerManager
	agentRegistry *AgentRegistry
	hub           *websocket.Hub
	mu            sync.RWMutex
}

// NewClusterManager creates a new ClusterManager registry instance
func NewClusterManager(hub *websocket.Hub) *ClusterManager {
	return &ClusterManager{
		clusters:      make(map[string]*InformerManager),
		agentRegistry: NewAgentRegistry(),
		hub:           hub,
	}
}

// AgentRegistry returns the agent registry for outbound agents
func (cm *ClusterManager) AgentRegistry() *AgentRegistry {
	return cm.agentRegistry
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

// RegisterClusterAlias registers an alternative identifier/alias (such as friendly cluster name) for a registered cluster.
func (cm *ClusterManager) RegisterClusterAlias(clusterID, alias string) {
	if alias == "" || alias == clusterID {
		return
	}
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if im, ok := cm.clusters[clusterID]; ok {
		cm.clusters[alias] = im
		log.Printf("[ClusterManager] Registered alias %q for cluster %q", alias, clusterID)
	}
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

// UnregisterAllClusters stops all running informers and clears the registry.
func (cm *ClusterManager) UnregisterAllClusters() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	for id, im := range cm.clusters {
		im.Stop()
		delete(cm.clusters, id)
		log.Printf("[ClusterManager] Unregistered and stopped informers for cluster: %s", id)
	}
}


// resolveInformerManagerLocked resolves an InformerManager by ID, name, or local development alias.
// Caller must hold cm.mu (either read or write lock).
func (cm *ClusterManager) resolveInformerManagerLocked(clusterID string) (*InformerManager, bool) {
	if im, ok := cm.clusters[clusterID]; ok {
		return im, true
	}
	// Case-insensitive exact match
	for id, im := range cm.clusters {
		if strings.EqualFold(id, clusterID) {
			return im, true
		}
	}
	// Fallback for single registered cluster, or common local development aliases
	if len(cm.clusters) > 0 {
		lower := strings.ToLower(clusterID)
		if lower == "minikube" || lower == "minikube-local" || lower == "local" || lower == "default" || lower == "development" {
			for _, im := range cm.clusters {
				return im, true
			}
		}
		if len(cm.clusters) == 1 {
			for _, im := range cm.clusters {
				return im, true
			}
		}
	}
	return nil, false
}

// GetClusterSnapshot retrieves the current cached state of pods, nodes, services, and workloads for a given cluster.
func (cm *ClusterManager) GetClusterSnapshot(clusterID string) (
	[]types.PodStatusDelta,
	[]types.NodeStatusDelta,
	[]types.ServiceStatusDelta,
	[]types.DeploymentStatusDelta,
	[]types.ReplicaSetStatusDelta,
	[]types.StatefulSetStatusDelta,
	[]types.DaemonSetStatusDelta,
	[]types.IngressStatusDelta,
	[]types.K8sIncidentEvent,
	[]types.CronJobStatusDelta,
	[]types.JobStatusDelta,
	[]types.PVCStatusDelta,
	[]types.PVStatusDelta,
	[]types.ConfigMapStatusDelta,
	[]types.SecretStatusDelta,
	error,
) {
	// 1. Check if cluster is streaming via an outbound agent first
	if agentSnap, found := cm.agentRegistry.GetSnapshot(clusterID); found && agentSnap != nil {
		return agentSnap.Pods, agentSnap.Nodes, agentSnap.Services, agentSnap.Deployments,
			agentSnap.ReplicaSets, agentSnap.StatefulSets, agentSnap.DaemonSets, agentSnap.Ingresses,
			agentSnap.Incidents, agentSnap.CronJobs, agentSnap.Jobs, agentSnap.PVCs, agentSnap.PVs,
			agentSnap.ConfigMaps, agentSnap.Secrets, nil
	}

	cm.mu.RLock()
	im, ok := cm.resolveInformerManagerLocked(clusterID)
	cm.mu.RUnlock()

	if !ok || im == nil {
		return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, fmt.Errorf("cluster %s not found", clusterID)
	}
	pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets := im.GetSnapshot()
	return pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets, nil
}

// GetHPASnapshot retrieves all cached HPAs for a cluster
func (cm *ClusterManager) GetHPASnapshot(clusterID string) []types.HPAStatusDelta {
	if agentSnap, found := cm.agentRegistry.GetSnapshot(clusterID); found && agentSnap != nil {
		return agentSnap.HPAs
	}

	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetHPASnapshot()
	}
	return nil
}

// GetNetworkPolicySnapshot retrieves all cached NetworkPolicies for a cluster
func (cm *ClusterManager) GetNetworkPolicySnapshot(clusterID string) []types.NetworkPolicyStatusDelta {
	if agentSnap, found := cm.agentRegistry.GetSnapshot(clusterID); found && agentSnap != nil {
		return agentSnap.NetworkPolicies
	}

	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetNetworkPolicySnapshot()
	}
	return nil
}

// GetPDBSnapshot retrieves all cached PodDisruptionBudgets for a cluster
func (cm *ClusterManager) GetPDBSnapshot(clusterID string) []types.PDBStatusDelta {
	if agentSnap, found := cm.agentRegistry.GetSnapshot(clusterID); found && agentSnap != nil {
		return agentSnap.PDBs
	}

	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetPDBSnapshot()
	}
	return nil
}

// GetResourceQuotaSnapshot retrieves all cached ResourceQuotas for a cluster
func (cm *ClusterManager) GetResourceQuotaSnapshot(clusterID string) []types.ResourceQuotaStatusDelta {
	if agentSnap, found := cm.agentRegistry.GetSnapshot(clusterID); found && agentSnap != nil {
		return agentSnap.ResourceQuotas
	}

	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetResourceQuotaSnapshot()
	}
	return nil
}

// GetLimitRangeSnapshot retrieves all cached LimitRanges for a cluster
func (cm *ClusterManager) GetLimitRangeSnapshot(clusterID string) []types.LimitRangeStatusDelta {
	if agentSnap, found := cm.agentRegistry.GetSnapshot(clusterID); found && agentSnap != nil {
		return agentSnap.LimitRanges
	}

	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetLimitRangeSnapshot()
	}
	return nil
}

// CheckPDBSafety checks if a workload is protected by a PDB and whether disruptions are allowed
func (cm *ClusterManager) CheckPDBSafety(clusterID, namespace, workloadName string, labels map[string]string) (*types.PDBStatusDelta, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	im, ok := cm.resolveInformerManagerLocked(clusterID)
	if !ok || im == nil {
		return nil, false
	}

	return im.CheckWorkloadPDB(namespace, workloadName, labels)
}

// GetCluster returns the InformerManager associated with the given clusterID.
func (cm *ClusterManager) GetCluster(clusterID string) (*InformerManager, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	return cm.resolveInformerManagerLocked(clusterID)
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

// GetClientset returns the kubernetes.Interface for the registered cluster with the
// given clusterID (or resolved name/alias). This implements the chaos.ClientsetProvider interface.
func (cm *ClusterManager) GetClientset(clusterID string) (kubernetes.Interface, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	im, ok := cm.resolveInformerManagerLocked(clusterID)
	if !ok || im == nil {
		return nil, fmt.Errorf("cluster %q is not registered", clusterID)
	}
	return im.Clientset(), nil
}
