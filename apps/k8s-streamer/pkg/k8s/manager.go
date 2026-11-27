package k8s

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// ResourceProber evaluates cluster RBAC and API group availability prior to informer startup.
type ResourceProber func(ctx context.Context, clusterID string, clientset kubernetes.Interface, watchSecrets bool) (allowed map[string]bool, metricsAllowed bool)

// ClusterManager maintains a dynamic, thread-safe registry of InformerManager instances keyed by cluster/workspace ID.
type ClusterManager struct {
	clusters       map[string]*InformerManager
	agentRegistry  *AgentRegistry
	hub            *websocket.Hub
	resourceProber ResourceProber
	onModeChange   func(clusterID string)
	mu             sync.RWMutex
}

// NewClusterManager creates a new ClusterManager registry instance
func NewClusterManager(hub *websocket.Hub) *ClusterManager {
	return &ClusterManager{
		clusters:      make(map[string]*InformerManager),
		agentRegistry: NewAgentRegistry(),
		hub:           hub,
	}
}

// SetResourceProber registers a startup capability probe applied before starting Direct informers.
func (cm *ClusterManager) SetResourceProber(prober ResourceProber) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.resourceProber = prober
}

// SetOnModeChange registers a callback invoked whenever a cluster transitions modes or is unregistered.
func (cm *ClusterManager) SetOnModeChange(fn func(clusterID string)) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.onModeChange = fn
}

func (cm *ClusterManager) notifyModeChange(clusterID string) {
	cm.mu.RLock()
	fn := cm.onModeChange
	cm.mu.RUnlock()
	if fn != nil {
		fn(clusterID)
	}
}

// PromoteToAgentSession transitions clusterID cleanly into Agent mode for sessionID,
// stopping any existing Direct InformerManager and evicting stale executor/capability state.
func (cm *ClusterManager) PromoteToAgentSession(clusterID, sessionID string) {
	if clusterID == "" {
		return
	}
	cm.mu.Lock()
	if existing, ok := cm.clusters[clusterID]; ok {
		existing.Stop()
		delete(cm.clusters, clusterID)
	}
	cm.mu.Unlock()

	cm.notifyModeChange(clusterID)
	cm.agentRegistry.RegisterSession(clusterID, sessionID)
}

func (cm *ClusterManager) applyStartupProbe(clusterID string, im *InformerManager) {
	cm.mu.RLock()
	prober := cm.resourceProber
	cm.mu.RUnlock()
	if prober == nil || im == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	allowed, metricsAllowed := prober(ctx, clusterID, im.Clientset(), im.WatchSecrets())
	im.SetAllowedResources(allowed)
	im.SetMetricsAllowed(metricsAllowed)
}

// AgentRegistry returns the agent registry for outbound agents
func (cm *ClusterManager) AgentRegistry() *AgentRegistry {
	return cm.agentRegistry
}

// RegisterCluster parses raw Kubeconfig bytes, instantiates an InformerManager, probes permitted resources, and starts informers asynchronously.
func (cm *ClusterManager) RegisterCluster(clusterID string, kubeconfigBytes []byte) error {
	im, err := NewInformerManager(kubeconfigBytes, cm.hub, clusterID)
	if err != nil {
		return fmt.Errorf("failed to register cluster %s: %w", clusterID, err)
	}

	cm.applyStartupProbe(clusterID, im)

	cm.agentRegistry.UnregisterCluster(clusterID)
	cm.notifyModeChange(clusterID)

	cm.mu.Lock()
	if existing, ok := cm.clusters[clusterID]; ok {
		existing.Stop()
		delete(cm.clusters, clusterID)
	}
	im.StartAsync()
	cm.clusters[clusterID] = im
	cm.mu.Unlock()

	log.Printf("[ClusterManager] Successfully registered and started cluster informers for: %s", clusterID)
	return nil
}

// RegisterInCluster creates, probes, and starts an InformerManager using in-cluster ServiceAccount config.
func (cm *ClusterManager) RegisterInCluster(clusterID string) error {
	im, err := NewInformerManagerInCluster(cm.hub, clusterID)
	if err != nil {
		return fmt.Errorf("failed to register in-cluster %s: %w", clusterID, err)
	}

	cm.applyStartupProbe(clusterID, im)
	cm.agentRegistry.UnregisterCluster(clusterID)
	cm.notifyModeChange(clusterID)

	cm.mu.Lock()
	if existing, ok := cm.clusters[clusterID]; ok {
		existing.Stop()
		delete(cm.clusters, clusterID)
	}
	im.StartAsync()
	cm.clusters[clusterID] = im
	cm.mu.Unlock()

	log.Printf("[ClusterManager] Successfully registered in-cluster informers for: %s", clusterID)
	return nil
}

// RegisterWithClientset registers an InformerManager with a pre-configured clientset (for testing/fake clientset use).
func (cm *ClusterManager) RegisterWithClientset(clusterID string, clientset kubernetes.Interface) *InformerManager {
	cm.agentRegistry.UnregisterCluster(clusterID)
	cm.notifyModeChange(clusterID)

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

// RegisterWithClientsetProbed runs the configured ResourceProber prior to starting informers.
func (cm *ClusterManager) RegisterWithClientsetProbed(clusterID string, clientset kubernetes.Interface) *InformerManager {
	im := NewInformerManagerWithClientset(clientset, cm.hub, clusterID)
	cm.applyStartupProbe(clusterID, im)
	cm.agentRegistry.UnregisterCluster(clusterID)
	cm.notifyModeChange(clusterID)

	cm.mu.Lock()
	defer cm.mu.Unlock()
	if existing, ok := cm.clusters[clusterID]; ok {
		existing.Stop()
		delete(cm.clusters, clusterID)
	}
	im.StartAsync()
	cm.clusters[clusterID] = im
	return im
}

// UnregisterCluster stops informers and/or removes agent state for clusterID.
func (cm *ClusterManager) UnregisterCluster(clusterID string) error {
	cm.mu.Lock()
	im, hasDirect := cm.clusters[clusterID]
	if hasDirect {
		im.Stop()
		delete(cm.clusters, clusterID)
	}
	cm.mu.Unlock()

	hasAgent := cm.agentRegistry.UnregisterCluster(clusterID)
	cm.notifyModeChange(clusterID)
	if !hasDirect && !hasAgent {
		return fmt.Errorf("cluster %s is not registered", clusterID)
	}

	log.Printf("[ClusterManager] Unregistered cluster: %s (direct=%v, agent=%v)", clusterID, hasDirect, hasAgent)
	return nil
}

// UnregisterAllClusters stops all running informers and clears agent and direct registries.
func (cm *ClusterManager) UnregisterAllClusters() {
	cm.mu.Lock()
	for id, im := range cm.clusters {
		im.Stop()
		delete(cm.clusters, id)
		log.Printf("[ClusterManager] Unregistered and stopped informers for cluster: %s", id)
	}
	cm.mu.Unlock()
	cm.agentRegistry.Clear()
}


// resolveInformerManagerLocked resolves an InformerManager strictly by exact clusterID.
// Caller must hold cm.mu (either read or write lock).
func (cm *ClusterManager) resolveInformerManagerLocked(clusterID string) (*InformerManager, bool) {
	if clusterID == "" {
		return nil, false
	}
	im, ok := cm.clusters[clusterID]
	return im, ok
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

// GetServiceAccountsSnapshot retrieves all cached ServiceAccounts for a cluster
func (cm *ClusterManager) GetServiceAccountsSnapshot(clusterID string) []types.ServiceAccountDelta {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetServiceAccountsSnapshot()
	}
	return nil
}

// GetRoleBindingsSnapshot retrieves all cached RoleBindings for a cluster
func (cm *ClusterManager) GetRoleBindingsSnapshot(clusterID string) []types.RoleBindingDelta {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetRoleBindingsSnapshot()
	}
	return nil
}

// GetClusterRoleBindingsSnapshot retrieves all cached ClusterRoleBindings for a cluster
func (cm *ClusterManager) GetClusterRoleBindingsSnapshot(clusterID string) []types.ClusterRoleBindingDelta {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetClusterRoleBindingsSnapshot()
	}
	return nil
}

// GetRolesSnapshot retrieves all cached Roles for a cluster
func (cm *ClusterManager) GetRolesSnapshot(clusterID string) []types.RoleDelta {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetRolesSnapshot()
	}
	return nil
}

// GetClusterRolesSnapshot retrieves all cached ClusterRoles for a cluster
func (cm *ClusterManager) GetClusterRolesSnapshot(clusterID string) []types.ClusterRoleDelta {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	if im, ok := cm.resolveInformerManagerLocked(clusterID); ok && im != nil {
		return im.GetClusterRolesSnapshot()
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

// ShutdownAll gracefully stops all active cluster informers and clears agent registrations.
func (cm *ClusterManager) ShutdownAll() {
	cm.mu.Lock()
	log.Printf("[ClusterManager] Shutting down all %d active cluster informers...", len(cm.clusters))
	for id, im := range cm.clusters {
		im.Stop()
		delete(cm.clusters, id)
	}
	cm.mu.Unlock()
	cm.agentRegistry.Clear()
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

// GetStreamClientset returns the kubernetes.Interface configured with Timeout=0 for persistent streaming
func (cm *ClusterManager) GetStreamClientset(clusterID string) (kubernetes.Interface, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	im, ok := cm.resolveInformerManagerLocked(clusterID)
	if !ok || im == nil {
		return nil, fmt.Errorf("cluster %q is not registered", clusterID)
	}
	return im.StreamClientset(), nil
}

// GetMetricsHistory returns the rolling cluster-level metrics history buffer for the cluster.
func (cm *ClusterManager) GetMetricsHistory(clusterID string) []types.ClusterMetricPoint {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	im, ok := cm.resolveInformerManagerLocked(clusterID)
	if !ok || im == nil {
		return []types.ClusterMetricPoint{}
	}
	return im.GetMetricsHistory()
}

