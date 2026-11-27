// Package executor provides the unified cluster execution abstraction over Direct
// and Agent-connected Kubernetes environments, normalized capability discovery,
// and standardized error taxonomy.
package executor

import (
	"context"
	"errors"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// ConnectionMode identifies how EnvScale reaches the Kubernetes cluster.
type ConnectionMode string

const (
	ModeDirect ConnectionMode = "direct"
	ModeAgent  ConnectionMode = "agent"
)

// ConnectionState describes live cluster transport and degradation health.
type ConnectionState string

const (
	StateConnected       ConnectionState = "connected"
	StateDegraded        ConnectionState = "degraded"
	StateReconnecting    ConnectionState = "reconnecting"
	StateDisconnected    ConnectionState = "disconnected"
	StateWaitingForAgent ConnectionState = "waiting_for_agent"
)

// CapabilityState distinguishes working, RBAC-denied, unavailable, transient, and deferred features.
type CapabilityState string

const (
	CapSupportedWorking       CapabilityState = "supported_working"
	CapPermissionDenied       CapabilityState = "permission_denied"
	CapClusterUnavailable     CapabilityState = "cluster_unavailable"
	CapTemporarilyUnavailable CapabilityState = "temporarily_unavailable"
	CapNotImplemented         CapabilityState = "not_implemented"
)

// Standard capability domain keys from docs/architecture/architecture-spec.md.
const (
	CapTopology           = "topology"
	CapLogs               = "logs"
	CapMetrics            = "metrics"
	CapEvents             = "events"
	CapResourceDelete     = "resource_delete"
	CapResourceApply      = "resource_apply"
	CapDeploymentScale    = "deployment_scale"
	CapDeploymentRollback = "deployment_rollback"
	CapChaosPodCrash      = "chaos_pod_crash"
	CapChaosScaleDown     = "chaos_scale_down"
	CapChaosOOMPressure   = "chaos_oom_pressure"
	CapPDBValidation      = "pdb_validation"
)

// CapabilityStatus describes the state and diagnostic reason of a single capability or API resource.
type CapabilityStatus struct {
	State     CapabilityState `json:"state"`
	Reason    string          `json:"reason,omitempty"`
	CheckedAt time.Time       `json:"checkedAt"`
	Details   map[string]any  `json:"details,omitempty"`
}

// ClusterCapabilities is the normalized capability and resource matrix returned for a cluster.
type ClusterCapabilities struct {
	ClusterID       string                      `json:"clusterId"`
	ConnectionMode  ConnectionMode              `json:"connectionMode"`
	ConnectionState ConnectionState             `json:"connectionState"`
	ProtocolVersion string                      `json:"protocolVersion,omitempty"`
	AgentVersion    string                      `json:"agentVersion,omitempty"`
	LastSyncAt      *time.Time                  `json:"lastSyncAt,omitempty"`
	StaleAfterSec   int                         `json:"staleAfterSec,omitempty"`
	Capabilities    map[string]CapabilityStatus `json:"capabilities"`
	Resources       map[string]CapabilityStatus `json:"resources"`
}

// Standardized executor sentinel errors.
var (
	ErrClusterNotFound       = errors.New("cluster not found")
	ErrClusterDisconnected   = errors.New("cluster is disconnected")
	ErrClusterUnreachable    = errors.New("cluster kubernetes API is unreachable")
	ErrCapabilityUnsupported = errors.New("capability not supported on this cluster")
	ErrPermissionDenied      = errors.New("kubernetes or workspace permission denied")
	ErrCommandTimeout        = errors.New("cluster command timed out")
	ErrCommandExpired        = errors.New("cluster command expired")
	ErrPDBBlocked            = errors.New("blocked by PodDisruptionBudget")
	ErrInvalidKubeconfig     = errors.New("invalid kubeconfig")
)

// SnapshotResponse is the unified normalized snapshot contract returned across Direct and Agent modes.
type SnapshotResponse struct {
	ClusterID              string                         `json:"clusterId"`
	ConnectionMode         ConnectionMode                 `json:"connectionMode"`
	ConnectionState        ConnectionState                `json:"connectionState"`
	LastSyncAt             *time.Time                     `json:"lastSyncAt,omitempty"`
	StaleAfterSec          int                            `json:"staleAfterSec"`
	Capabilities           ClusterCapabilities            `json:"capabilities"`
	Pods                   []types.PodStatusDelta         `json:"pods"`
	Nodes                  []types.NodeStatusDelta        `json:"nodes"`
	Services               []types.ServiceStatusDelta     `json:"services"`
	Deployments            []types.DeploymentStatusDelta  `json:"deployments"`
	ReplicaSets            []types.ReplicaSetStatusDelta  `json:"replicaSets"`
	StatefulSets           []types.StatefulSetStatusDelta `json:"statefulSets"`
	DaemonSets             []types.DaemonSetStatusDelta   `json:"daemonSets"`
	Ingresses              []types.IngressStatusDelta     `json:"ingresses"`
	Incidents              []types.K8sIncidentEvent       `json:"incidents"`
	CronJobs               []types.CronJobStatusDelta     `json:"cronJobs"`
	Jobs                   []types.JobStatusDelta         `json:"jobs"`
	PVCs                   []types.PVCStatusDelta         `json:"pvcs"`
	PVs                    []types.PVStatusDelta          `json:"pvs"`
	ConfigMaps             []types.ConfigMapStatusDelta   `json:"configMaps"`
	Secrets                []types.SecretStatusDelta      `json:"secrets"`
	HPAs                   []types.HPAStatusDelta         `json:"hpas"`
	NetworkPolicies        []types.NetworkPolicyStatusDelta `json:"networkPolicies"`
	PDBs                   []types.PDBStatusDelta         `json:"pdbs"`
	ResourceQuotas         []types.ResourceQuotaStatusDelta   `json:"resourceQuotas"`
	LimitRanges            []types.LimitRangeStatusDelta      `json:"limitRanges"`
	VolumeSnapshots        []types.VolumeSnapshotDelta        `json:"volumeSnapshots"`
	VolumeSnapshotContents []types.VolumeSnapshotContentDelta `json:"volumeSnapshotContents"`
	ServiceAccounts        []types.ServiceAccountDelta        `json:"serviceAccounts"`
	RoleBindings           []types.RoleBindingDelta       `json:"roleBindings"`
	ClusterRoleBindings    []types.ClusterRoleBindingDelta `json:"clusterRoleBindings"`
	Roles                  []types.RoleDelta              `json:"roles"`
	ClusterRoles           []types.ClusterRoleDelta       `json:"clusterRoles"`
	MetricsHistory         []types.ClusterMetricPoint     `json:"metricsHistory"`
}

// PDBCheckRequest defines normalized inputs for pre-mutation PDB verification.
type PDBCheckRequest struct {
	Namespace    string `json:"namespace"`
	TargetKind   string `json:"targetKind"`
	TargetName   string `json:"targetName"`
	Force        bool   `json:"force"`
}

// PDBCheckResult represents the normalized outcome of a PDB safety check.
type PDBCheckResult struct {
	Allowed            bool   `json:"allowed"`
	PDBName            string `json:"pdbName,omitempty"`
	DisruptionsAllowed int32  `json:"disruptionsAllowed"`
	Message            string `json:"message,omitempty"`
}

// LogStreamRequest configures normalized log tailing without exposing client-go types.
type LogStreamRequest struct {
	StreamID   string `json:"streamId"`
	Namespace  string `json:"namespace"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Container  string `json:"container,omitempty"`
	TailLines  int64  `json:"tailLines"`
	Follow     bool   `json:"follow"`
}

// LogFrame represents a normalized log or stream diagnostic entry.
type LogFrame struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Namespace string `json:"namespace,omitempty"`
	Pod       string `json:"pod,omitempty"`
	Container string `json:"container,omitempty"`
	Source    string `json:"source,omitempty"`
	Level     string `json:"level,omitempty"`
	Message   string `json:"message,omitempty"`
	Status    string `json:"status,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// StreamHandle controls an active log stream session.
type StreamHandle interface {
	StreamID() string
	Close() error
}

// ClusterCommand represents a normalized mutating or diagnostic command.
type ClusterCommand struct {
	CommandID      string         `json:"commandId"`
	OperationType  string         `json:"operationType"`
	IdempotencyKey string         `json:"idempotencyKey,omitempty"`
	Payload        map[string]any `json:"payload"`
	TimeoutMs      int64          `json:"timeoutMs"`
}

// CommandResult captures the normalized outcome of ExecuteOperation.
type CommandResult struct {
	CommandID string         `json:"commandId"`
	Status    string         `json:"status"`
	Data      map[string]any `json:"data,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// ClusterExecutor defines the unified control-plane contract across Direct and Agent transports.
// It expresses EnvScale operations using normalized types only and never leaks kubernetes.Interface.
type ClusterExecutor interface {
	ClusterID() string
	Mode() ConnectionMode
	State(ctx context.Context) ConnectionState
	Capabilities(ctx context.Context) ClusterCapabilities
	GetSnapshot(ctx context.Context) (*SnapshotResponse, error)
	CheckPDBSafety(ctx context.Context, req PDBCheckRequest) (*PDBCheckResult, error)
	StartLogStream(ctx context.Context, req LogStreamRequest, sink chan<- LogFrame) (StreamHandle, error)
	ExecuteOperation(ctx context.Context, cmd ClusterCommand) (*CommandResult, error)
	Close() error
}

