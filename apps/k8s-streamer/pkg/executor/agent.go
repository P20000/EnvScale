package executor

import (
	"context"
	"fmt"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

// AgentExecutor implements ClusterExecutor for clusters connected via outbound envscale-agent.
type AgentExecutor struct {
	clusterID string
	registry  *k8s.AgentRegistry
	capsReg   *ClusterCapabilityRegistry
}

// NewAgentExecutor creates an AgentExecutor backed by AgentRegistry and ClusterCapabilityRegistry.
func NewAgentExecutor(clusterID string, registry *k8s.AgentRegistry, capsReg *ClusterCapabilityRegistry) *AgentExecutor {
	return &AgentExecutor{
		clusterID: clusterID,
		registry:  registry,
		capsReg:   capsReg,
	}
}

func (a *AgentExecutor) ClusterID() string    { return a.clusterID }
func (a *AgentExecutor) Mode() ConnectionMode { return ModeAgent }

func (a *AgentExecutor) State(ctx context.Context) ConnectionState {
	return a.Capabilities(ctx).ConnectionState
}

func (a *AgentExecutor) Capabilities(_ context.Context) ClusterCapabilities {
	if a.registry == nil {
		return BuildAgentCapabilities(a.clusterID, k8s.AgentClusterMeta{ClusterID: a.clusterID})
	}
	meta, ok := a.registry.GetStateMeta(a.clusterID)
	if !ok {
		meta = k8s.AgentClusterMeta{ClusterID: a.clusterID, ProtocolVersion: "1.0"}
	}
	caps := BuildAgentCapabilities(a.clusterID, meta)
	if a.capsReg != nil && ok {
		genKey := fmt.Sprintf("agent:%s", meta.SessionID)
		a.capsReg.RegisterGeneration(a.clusterID, genKey)
		a.capsReg.SetIfGeneration(a.clusterID, genKey, caps)
	}
	return caps
}

func (a *AgentExecutor) GetSnapshot(ctx context.Context) (*SnapshotResponse, error) {
	if a.registry == nil {
		return nil, fmt.Errorf("%w: agent registry unavailable", ErrClusterNotFound)
	}

	meta, exists := a.registry.GetStateMeta(a.clusterID)
	if !exists {
		return nil, fmt.Errorf("%w: agent cluster %s is not registered", ErrClusterNotFound, a.clusterID)
	}

	caps := a.Capabilities(ctx)
	if !meta.Connected {
		if !meta.EverSynced {
			return nil, fmt.Errorf("%w: waiting for agent connection for cluster %s", ErrClusterDisconnected, a.clusterID)
		}
		return nil, fmt.Errorf("%w: agent for cluster %s is disconnected (last seen %s)",
			ErrClusterDisconnected, a.clusterID, meta.LastSeen.UTC().Format(time.RFC3339))
	}

	if !meta.HasSnapshot || (meta.SessionID != "" && meta.SnapshotSessionID != "" && meta.SnapshotSessionID != meta.SessionID) {
		return nil, fmt.Errorf("%w: waiting for baseline snapshot from active agent session for cluster %s", ErrClusterDisconnected, a.clusterID)
	}

	snap, ok := a.registry.GetSnapshot(a.clusterID)
	if !ok || snap == nil {
		return nil, fmt.Errorf("%w: waiting for baseline snapshot from active agent session for cluster %s", ErrClusterDisconnected, a.clusterID)
	}

	var lastSync *time.Time
	if !meta.LastSeen.IsZero() {
		t := meta.LastSeen.UTC()
		lastSync = &t
	}

	return &SnapshotResponse{
		ClusterID:              a.clusterID,
		ConnectionMode:         ModeAgent,
		ConnectionState:        caps.ConnectionState,
		LastSyncAt:             lastSync,
		StaleAfterSec:          120,
		Capabilities:           caps,
		Pods:                   snap.Pods,
		Nodes:                  snap.Nodes,
		Services:               snap.Services,
		Deployments:            snap.Deployments,
		ReplicaSets:            snap.ReplicaSets,
		StatefulSets:           snap.StatefulSets,
		DaemonSets:             snap.DaemonSets,
		Ingresses:              snap.Ingresses,
		Incidents:              snap.Incidents,
		CronJobs:               snap.CronJobs,
		Jobs:                   snap.Jobs,
		PVCs:                   snap.PVCs,
		PVs:                    snap.PVs,
		ConfigMaps:             snap.ConfigMaps,
		Secrets:                snap.Secrets,
		HPAs:                   snap.HPAs,
		NetworkPolicies:        snap.NetworkPolicies,
		PDBs:                   snap.PDBs,
		ResourceQuotas:         snap.ResourceQuotas,
		LimitRanges:            snap.LimitRanges,
		VolumeSnapshots:        snap.VolumeSnapshots,
		VolumeSnapshotContents: snap.VolumeSnapshotContents,
		ServiceAccounts:        snap.ServiceAccounts,
		RoleBindings:           snap.RoleBindings,
		ClusterRoleBindings:    snap.ClusterRoleBindings,
		Roles:                  snap.Roles,
		ClusterRoles:           snap.ClusterRoles,
		MetricsHistory:         nil,
	}, nil
}

func (a *AgentExecutor) CheckPDBSafety(_ context.Context, _ PDBCheckRequest) (*PDBCheckResult, error) {
	return nil, fmt.Errorf("%w: CheckPDBSafety over Agent protocol is scheduled for a subsequent executor slice", ErrCapabilityUnsupported)
}

func (a *AgentExecutor) ExecuteOperation(_ context.Context, _ ClusterCommand) (*CommandResult, error) {
	return nil, fmt.Errorf("%w: ExecuteOperation over Agent protocol is scheduled for a subsequent executor slice", ErrCapabilityUnsupported)
}

func (a *AgentExecutor) Close() error {
	if a.capsReg != nil {
		a.capsReg.Delete(a.clusterID)
	}
	return nil
}
