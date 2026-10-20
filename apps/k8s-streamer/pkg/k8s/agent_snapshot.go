package k8s

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// AgentClusterState stores the in-memory cached snapshot and status of an agent-connected cluster
type AgentClusterState struct {
	ClusterID string
	Snapshot  types.ClusterSnapshot
	LastSeen  time.Time
	Connected bool
	mu        sync.RWMutex
}

// AgentRegistry manages clusters streaming from in-cluster envscale-agents
type AgentRegistry struct {
	clusters map[string]*AgentClusterState
	mu       sync.RWMutex
}

// NewAgentRegistry creates a new AgentRegistry
func NewAgentRegistry() *AgentRegistry {
	return &AgentRegistry{
		clusters: make(map[string]*AgentClusterState),
	}
}

// SetSnapshot registers or updates a complete baseline snapshot for an agent cluster
func (ar *AgentRegistry) SetSnapshot(clusterID string, snapshot types.ClusterSnapshot) {
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
	state.Snapshot = snapshot
	state.LastSeen = time.Now()
	state.Connected = true
	state.mu.Unlock()

	log.Printf("[AgentRegistry] Registered snapshot for cluster '%s' (%d pods, %d nodes, %d services)",
		clusterID, len(snapshot.Pods), len(snapshot.Nodes), len(snapshot.Services))
}

// GetSnapshot retrieves the snapshot for an agent cluster
func (ar *AgentRegistry) GetSnapshot(clusterID string) (*types.ClusterSnapshot, bool) {
	ar.mu.RLock()
	state, ok := ar.clusters[clusterID]
	if !ok && len(ar.clusters) == 1 {
		// Fallback if only 1 agent is connected
		for _, v := range ar.clusters {
			state = v
			ok = true
			break
		}
	}
	ar.mu.RUnlock()

	if !ok || state == nil {
		return nil, false
	}

	state.mu.RLock()
	defer state.mu.RUnlock()

	// Return a copy
	cp := state.Snapshot
	return &cp, true
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

// ApplyDelta updates the cached snapshot in real-time when delta events arrive
func (ar *AgentRegistry) ApplyDelta(clusterID string, eventType string, rawData []byte) {
	ar.mu.RLock()
	state, ok := ar.clusters[clusterID]
	ar.mu.RUnlock()

	if !ok || state == nil {
		return
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	state.LastSeen = time.Now()

	switch eventType {
	case types.EventPodStatusChanged:
		var pod types.PodStatusDelta
		if err := json.Unmarshal(rawData, &pod); err == nil {
			found := false
			for i, p := range state.Snapshot.Pods {
				if p.Name == pod.Name && p.Namespace == pod.Namespace {
					state.Snapshot.Pods[i] = pod
					found = true
					break
				}
			}
			if !found {
				state.Snapshot.Pods = append(state.Snapshot.Pods, pod)
			}
		}

	case types.EventPodDeleted:
		var pod types.PodStatusDelta
		if err := json.Unmarshal(rawData, &pod); err == nil {
			filtered := state.Snapshot.Pods[:0]
			for _, p := range state.Snapshot.Pods {
				if !(p.Name == pod.Name && p.Namespace == pod.Namespace) {
					filtered = append(filtered, p)
				}
			}
			state.Snapshot.Pods = filtered
		}

	case types.EventNodeMutated:
		var node types.NodeStatusDelta
		if err := json.Unmarshal(rawData, &node); err == nil {
			found := false
			for i, n := range state.Snapshot.Nodes {
				if n.Name == node.Name {
					state.Snapshot.Nodes[i] = node
					found = true
					break
				}
			}
			if !found {
				state.Snapshot.Nodes = append(state.Snapshot.Nodes, node)
			}
		}

	case types.EventDeploymentMutated:
		var dep types.DeploymentStatusDelta
		if err := json.Unmarshal(rawData, &dep); err == nil {
			found := false
			for i, d := range state.Snapshot.Deployments {
				if d.Name == dep.Name && d.Namespace == dep.Namespace {
					state.Snapshot.Deployments[i] = dep
					found = true
					break
				}
			}
			if !found {
				state.Snapshot.Deployments = append(state.Snapshot.Deployments, dep)
			}
		}

	case types.EventDeploymentDeleted:
		var dep types.DeploymentStatusDelta
		if err := json.Unmarshal(rawData, &dep); err == nil {
			filtered := state.Snapshot.Deployments[:0]
			for _, d := range state.Snapshot.Deployments {
				if !(d.Name == dep.Name && d.Namespace == dep.Namespace) {
					filtered = append(filtered, d)
				}
			}
			state.Snapshot.Deployments = filtered
		}

	case types.EventServiceMutated:
		var svc types.ServiceStatusDelta
		if err := json.Unmarshal(rawData, &svc); err == nil {
			found := false
			for i, s := range state.Snapshot.Services {
				if s.Name == svc.Name && s.Namespace == svc.Namespace {
					state.Snapshot.Services[i] = svc
					found = true
					break
				}
			}
			if !found {
				state.Snapshot.Services = append(state.Snapshot.Services, svc)
			}
		}
	}
}

// BuildClusterSnapshot assembles a complete types.ClusterSnapshot from an InformerManager
func BuildClusterSnapshot(im *InformerManager) types.ClusterSnapshot {
	pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets := im.GetSnapshot()
	return types.ClusterSnapshot{
		Pods:            pods,
		Nodes:           nodes,
		Services:        services,
		Deployments:     deployments,
		ReplicaSets:     replicaSets,
		StatefulSets:    statefulSets,
		DaemonSets:      daemonSets,
		Ingresses:       ingresses,
		Incidents:       incidents,
		CronJobs:        cronJobs,
		Jobs:            jobs,
		PVCs:            pvcs,
		PVs:             pvs,
		ConfigMaps:      configMaps,
		Secrets:         secrets,
		HPAs:            im.GetHPASnapshot(),
		NetworkPolicies: im.GetNetworkPolicySnapshot(),
		PDBs:            im.GetPDBSnapshot(),
	}
}
