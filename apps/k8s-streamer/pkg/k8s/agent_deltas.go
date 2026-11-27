package k8s

import (
	"encoding/json"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// ApplyDelta updates the cached snapshot in real-time when delta events arrive
func (ar *AgentRegistry) ApplyDelta(clusterID string, eventType string, rawData []byte) {
	ar.ApplyDeltaForSession(clusterID, "", eventType, rawData)
}

// ApplyDeltaForSession applies a live delta only if sessionID matches the active session and a baseline snapshot exists.
func (ar *AgentRegistry) ApplyDeltaForSession(clusterID, sessionID, eventType string, rawData []byte) {
	ar.mu.RLock()
	state, ok := ar.clusters[clusterID]
	ar.mu.RUnlock()

	if !ok || state == nil {
		return
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.SessionID != "" && sessionID != "" && state.SessionID != sessionID {
		return
	}
	if !state.HasSnapshot {
		return
	}
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
			filtered := make([]types.PodStatusDelta, 0, len(state.Snapshot.Pods))
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
			filtered := make([]types.DeploymentStatusDelta, 0, len(state.Snapshot.Deployments))
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

