package k8s

import (
	"log"
	"sync"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// AgentClusterMeta summarizes connection & protocol state without exposing full snapshot slices.
type AgentClusterMeta struct {
	ClusterID            string                                 `json:"clusterId"`
	SessionID            string                                 `json:"sessionId"`
	SnapshotSessionID    string                                 `json:"snapshotSessionId,omitempty"`
	Connected            bool                                   `json:"connected"`
	HasSnapshot          bool                                   `json:"hasSnapshot"`
	EverSynced           bool                                   `json:"everSynced"`
	LastSeen             time.Time                              `json:"lastSeen"`
	ProtocolVersion      string                                 `json:"protocolVersion"`
	AgentVersion         string                                 `json:"agentVersion,omitempty"`
	SyncedResources      map[string]bool                        `json:"syncedResources,omitempty"`
	ReportedCapabilities map[string]types.AgentCapabilityReport `json:"reportedCapabilities,omitempty"`
}

// AgentClusterState stores the in-memory cached snapshot and status of an agent-connected cluster
type AgentClusterState struct {
	ClusterID            string
	SessionID            string
	SnapshotSessionID    string
	ProtocolVersion      string
	AgentVersion         string
	Snapshot             types.ClusterSnapshot
	SyncedResources      map[string]bool
	ReportedCapabilities map[string]types.AgentCapabilityReport
	HasSnapshot          bool
	EverSynced           bool
	LastSeen             time.Time
	Connected            bool
	mu                   sync.RWMutex
}

// RegisterSession marks the active streaming session for clusterID as connected.
// When a new session reconnects after a prior session, any previous session's snapshot is cleared
// so stale data cannot be served as fresh connected state.
func (ar *AgentRegistry) RegisterSession(clusterID, sessionID string) {
	if clusterID == "" {
		return
	}
	ar.mu.Lock()
	defer ar.mu.Unlock()

	state, ok := ar.clusters[clusterID]
	if !ok {
		state = &AgentClusterState{
			ClusterID:       clusterID,
			ProtocolVersion: "1.0",
		}
		ar.clusters[clusterID] = state
	}

	state.mu.Lock()
	if state.SessionID != "" && sessionID != "" && state.SessionID != sessionID {
		state.HasSnapshot = false
		state.SnapshotSessionID = ""
		state.Snapshot = types.ClusterSnapshot{}
		state.SyncedResources = nil
		state.ReportedCapabilities = nil
		state.ProtocolVersion = "1.0"
	}
	state.SessionID = sessionID
	if state.ProtocolVersion == "" {
		state.ProtocolVersion = "1.0"
	}
	state.LastSeen = time.Now()
	state.Connected = true
	state.mu.Unlock()
}

// HasCluster reports whether clusterID exists in the agent registry (connected or previously registered).
func (ar *AgentRegistry) HasCluster(clusterID string) bool {
	if clusterID == "" {
		return false
	}
	ar.mu.RLock()
	_, ok := ar.clusters[clusterID]
	ar.mu.RUnlock()
	return ok
}

// GetStateMeta retrieves connection and protocol metadata strictly for clusterID.
func (ar *AgentRegistry) GetStateMeta(clusterID string) (AgentClusterMeta, bool) {
	if clusterID == "" {
		return AgentClusterMeta{}, false
	}
	ar.mu.RLock()
	state, ok := ar.clusters[clusterID]
	ar.mu.RUnlock()
	if !ok || state == nil {
		return AgentClusterMeta{}, false
	}

	state.mu.RLock()
	defer state.mu.RUnlock()
	proto := state.ProtocolVersion
	if proto == "" {
		proto = "1.0"
	}
	var syncedCopy map[string]bool
	if len(state.SyncedResources) > 0 {
		syncedCopy = make(map[string]bool, len(state.SyncedResources))
		for k, v := range state.SyncedResources {
			syncedCopy[k] = v
		}
	}
	var reportedCopy map[string]types.AgentCapabilityReport
	if len(state.ReportedCapabilities) > 0 {
		reportedCopy = make(map[string]types.AgentCapabilityReport, len(state.ReportedCapabilities))
		for k, v := range state.ReportedCapabilities {
			reportedCopy[k] = v
		}
	}
	return AgentClusterMeta{
		ClusterID:            state.ClusterID,
		SessionID:            state.SessionID,
		SnapshotSessionID:    state.SnapshotSessionID,
		Connected:            state.Connected,
		HasSnapshot:          state.HasSnapshot,
		EverSynced:           state.EverSynced,
		LastSeen:             state.LastSeen,
		ProtocolVersion:      proto,
		AgentVersion:         state.AgentVersion,
		SyncedResources:      syncedCopy,
		ReportedCapabilities: reportedCopy,
	}, true
}

// MarkDisconnectedSession marks clusterID disconnected only if sessionID still owns the active connection.
// Prevents a stale or half-open socket from clobbering a freshly reconnected agent session.
func (ar *AgentRegistry) MarkDisconnectedSession(clusterID, sessionID string) bool {
	if clusterID == "" {
		return false
	}
	ar.mu.Lock()
	defer ar.mu.Unlock()

	state, ok := ar.clusters[clusterID]
	if !ok || state == nil {
		return false
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.SessionID != "" && sessionID != "" && state.SessionID != sessionID {
		return false
	}
	state.Connected = false
	state.LastSeen = time.Now()
	log.Printf("[AgentRegistry] Agent cluster '%s' marked disconnected (session %s)", clusterID, sessionID)
	return true
}

// AgentRegistry manages clusters streaming from in-cluster envscale-agents
type AgentRegistry struct {
	clusters   map[string]*AgentClusterState
	sessionHub *AgentSessionHub
	mu         sync.RWMutex
}

// NewAgentRegistry creates a new AgentRegistry
func NewAgentRegistry() *AgentRegistry {
	return &AgentRegistry{
		clusters:   make(map[string]*AgentClusterState),
		sessionHub: NewAgentSessionHub(),
	}
}

func cloneSlice[T any](in []T) []T {
	if in == nil {
		return nil
	}
	out := make([]T, len(in))
	copy(out, in)
	return out
}

func cloneClusterSnapshot(s types.ClusterSnapshot) types.ClusterSnapshot {
	return types.ClusterSnapshot{
		Pods:                   cloneSlice(s.Pods),
		Nodes:                  cloneSlice(s.Nodes),
		Services:               cloneSlice(s.Services),
		Deployments:            cloneSlice(s.Deployments),
		ReplicaSets:            cloneSlice(s.ReplicaSets),
		StatefulSets:           cloneSlice(s.StatefulSets),
		DaemonSets:             cloneSlice(s.DaemonSets),
		Ingresses:              cloneSlice(s.Ingresses),
		Incidents:              cloneSlice(s.Incidents),
		CronJobs:               cloneSlice(s.CronJobs),
		Jobs:                   cloneSlice(s.Jobs),
		PVCs:                   cloneSlice(s.PVCs),
		PVs:                    cloneSlice(s.PVs),
		ConfigMaps:             cloneSlice(s.ConfigMaps),
		Secrets:                cloneSlice(s.Secrets),
		HPAs:                   cloneSlice(s.HPAs),
		NetworkPolicies:        cloneSlice(s.NetworkPolicies),
		PDBs:                   cloneSlice(s.PDBs),
		ResourceQuotas:         cloneSlice(s.ResourceQuotas),
		LimitRanges:            cloneSlice(s.LimitRanges),
		VolumeSnapshots:        cloneSlice(s.VolumeSnapshots),
		VolumeSnapshotContents: cloneSlice(s.VolumeSnapshotContents),
		ServiceAccounts:        cloneSlice(s.ServiceAccounts),
		RoleBindings:           cloneSlice(s.RoleBindings),
		ClusterRoleBindings:    cloneSlice(s.ClusterRoleBindings),
		Roles:                  cloneSlice(s.Roles),
		ClusterRoles:           cloneSlice(s.ClusterRoles),
	}
}

func computeSyncedResources(s types.ClusterSnapshot) map[string]bool {
	synced := make(map[string]bool)
	mark := func(key string, present bool) {
		if present {
			synced[key] = true
		}
	}
	mark("core/v1/pods", s.Pods != nil)
	mark("core/v1/nodes", s.Nodes != nil)
	mark("core/v1/services", s.Services != nil)
	mark("apps/v1/deployments", s.Deployments != nil)
	mark("apps/v1/replicasets", s.ReplicaSets != nil)
	mark("apps/v1/statefulsets", s.StatefulSets != nil)
	mark("apps/v1/daemonsets", s.DaemonSets != nil)
	mark("networking.k8s.io/v1/ingresses", s.Ingresses != nil)
	mark("core/v1/events", s.Incidents != nil)
	mark("batch/v1/cronjobs", s.CronJobs != nil)
	mark("batch/v1/jobs", s.Jobs != nil)
	mark("core/v1/persistentvolumeclaims", s.PVCs != nil)
	mark("core/v1/persistentvolumes", s.PVs != nil)
	mark("core/v1/configmaps", s.ConfigMaps != nil)
	mark("core/v1/secrets", s.Secrets != nil)
	mark("autoscaling/v2/horizontalpodautoscalers", s.HPAs != nil)
	mark("networking.k8s.io/v1/networkpolicies", s.NetworkPolicies != nil)
	mark("policy/v1/poddisruptionbudgets", s.PDBs != nil)
	mark("core/v1/resourcequotas", s.ResourceQuotas != nil)
	mark("core/v1/limitranges", s.LimitRanges != nil)
	mark("snapshot.storage.k8s.io/v1/volumesnapshots", s.VolumeSnapshots != nil)
	mark("snapshot.storage.k8s.io/v1/volumesnapshotcontents", s.VolumeSnapshotContents != nil)
	mark("core/v1/serviceaccounts", s.ServiceAccounts != nil)
	mark("rbac.authorization.k8s.io/v1/rolebindings", s.RoleBindings != nil)
	mark("rbac.authorization.k8s.io/v1/clusterrolebindings", s.ClusterRoleBindings != nil)
	mark("rbac.authorization.k8s.io/v1/roles", s.Roles != nil)
	mark("rbac.authorization.k8s.io/v1/clusterroles", s.ClusterRoles != nil)
	return synced
}

// SetSnapshot registers or updates a complete baseline snapshot for an agent cluster
func (ar *AgentRegistry) SetSnapshot(clusterID string, snapshot types.ClusterSnapshot) {
	_ = ar.SetSnapshotForSession(clusterID, "", snapshot)
}

// SetSnapshotForSession updates the baseline snapshot only if sessionID owns the active session (or sessionID == "").
func (ar *AgentRegistry) SetSnapshotForSession(clusterID, sessionID string, snapshot types.ClusterSnapshot) bool {
	if clusterID == "" {
		return false
	}
	ar.mu.Lock()
	defer ar.mu.Unlock()

	state, ok := ar.clusters[clusterID]
	if !ok {
		state = &AgentClusterState{
			ClusterID: clusterID,
		}
		ar.clusters[clusterID] = state
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.SessionID != "" && sessionID != "" && state.SessionID != sessionID {
		return false
	}
	state.Snapshot = cloneClusterSnapshot(snapshot)
	state.SyncedResources = computeSyncedResources(snapshot)
	state.HasSnapshot = true
	state.EverSynced = true
	if sessionID != "" {
		state.SnapshotSessionID = sessionID
	} else {
		state.SnapshotSessionID = state.SessionID
	}
	if state.ProtocolVersion == "" {
		state.ProtocolVersion = "1.0"
	}
	state.LastSeen = time.Now()
	state.Connected = true

	log.Printf("[AgentRegistry] Registered snapshot for cluster '%s' (%d pods, %d nodes, %d services)",
		clusterID, len(snapshot.Pods), len(snapshot.Nodes), len(snapshot.Services))
	return true
}

// GetSnapshot retrieves an isolated deep-copied snapshot strictly for the requested clusterID.
func (ar *AgentRegistry) GetSnapshot(clusterID string) (*types.ClusterSnapshot, bool) {
	if clusterID == "" {
		return nil, false
	}
	ar.mu.RLock()
	state, ok := ar.clusters[clusterID]
	ar.mu.RUnlock()

	if !ok || state == nil || !state.HasSnapshot {
		return nil, false
	}

	state.mu.RLock()
	defer state.mu.RUnlock()
	if !state.HasSnapshot {
		return nil, false
	}

	cp := cloneClusterSnapshot(state.Snapshot)
	return &cp, true
}

// UnregisterCluster removes an agent-connected cluster from the registry.
func (ar *AgentRegistry) UnregisterCluster(clusterID string) bool {
	if clusterID == "" {
		return false
	}
	if ar.sessionHub != nil {
		ar.sessionHub.DetachCluster(clusterID, "cluster_unregistered", "Agent cluster was unregistered")
	}
	ar.mu.Lock()
	defer ar.mu.Unlock()
	if _, ok := ar.clusters[clusterID]; !ok {
		return false
	}
	delete(ar.clusters, clusterID)
	return true
}

// Clear removes all agent-connected cluster entries from the registry.
func (ar *AgentRegistry) Clear() {
	if ar.sessionHub != nil {
		ar.sessionHub.DetachAll("cluster_unregistered", "Agent registry cleared")
	}
	ar.mu.Lock()
	defer ar.mu.Unlock()
	ar.clusters = make(map[string]*AgentClusterState)
}

// MarkDisconnected flags the agent cluster as disconnected
func (ar *AgentRegistry) MarkDisconnected(clusterID string) {
	ar.mu.Lock()
	defer ar.mu.Unlock()

	if state, ok := ar.clusters[clusterID]; ok {
		state.mu.Lock()
		state.Connected = false
		state.LastSeen = time.Now()
		state.mu.Unlock()
		log.Printf("[AgentRegistry] Agent cluster '%s' marked disconnected", clusterID)
	}
}

// IsConnected returns whether the agent cluster is currently streaming
func (ar *AgentRegistry) IsConnected(clusterID string) bool {
	ar.mu.RLock()
	defer ar.mu.RUnlock()

	if state, ok := ar.clusters[clusterID]; ok {
		state.mu.RLock()
		defer state.mu.RUnlock()
		return state.Connected
	}
	return false
}

// BuildClusterSnapshot assembles a complete types.ClusterSnapshot from an InformerManager
func BuildClusterSnapshot(im *InformerManager) types.ClusterSnapshot {
	pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets := im.GetSnapshot()
	return types.ClusterSnapshot{
		Pods:                pods,
		Nodes:               nodes,
		Services:            services,
		Deployments:         deployments,
		ReplicaSets:         replicaSets,
		StatefulSets:        statefulSets,
		DaemonSets:          daemonSets,
		Ingresses:           ingresses,
		Incidents:           incidents,
		CronJobs:            cronJobs,
		Jobs:                jobs,
		PVCs:                pvcs,
		PVs:                 pvs,
		ConfigMaps:          configMaps,
		Secrets:             secrets,
		HPAs:                im.GetHPASnapshot(),
		NetworkPolicies:     im.GetNetworkPolicySnapshot(),
		PDBs:                im.GetPDBSnapshot(),
		ResourceQuotas:      im.GetResourceQuotaSnapshot(),
		LimitRanges:         im.GetLimitRangeSnapshot(),
		ServiceAccounts:     im.GetServiceAccountsSnapshot(),
		RoleBindings:        im.GetRoleBindingsSnapshot(),
		ClusterRoleBindings: im.GetClusterRoleBindingsSnapshot(),
		Roles:               im.GetRolesSnapshot(),
		ClusterRoles:        im.GetClusterRolesSnapshot(),
	}
}
