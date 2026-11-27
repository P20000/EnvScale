package executor

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

const (
	directCapabilityCacheTTL = 60 * time.Second
	directFailureCacheTTL    = 5 * time.Second
)

var directFallbackGenSeq atomic.Uint64

type probeCall struct {
	done chan struct{}
	caps ClusterCapabilities
}

// DirectExecutor implements ClusterExecutor over a direct kubeconfig / in-cluster InformerManager.
type DirectExecutor struct {
	clusterID   string
	im          *k8s.InformerManager
	registry    *ClusterCapabilityRegistry
	genKey      string
	invalidated atomic.Bool

	closeCtx    context.Context
	closeCancel context.CancelFunc

	mu          sync.Mutex
	lastProbe   time.Time
	lastFailure bool

	probeMu  sync.Mutex
	inFlight *probeCall
}

// NewDirectExecutor creates a DirectExecutor bound to an InformerManager generation.
func NewDirectExecutor(clusterID string, im *k8s.InformerManager, registry *ClusterCapabilityRegistry) *DirectExecutor {
	var genKey string
	if im != nil {
		genKey = fmt.Sprintf("direct:%d", im.Generation())
	} else {
		genKey = fmt.Sprintf("direct-nil:%d", directFallbackGenSeq.Add(1))
	}
	if registry != nil {
		registry.RegisterGeneration(clusterID, genKey)
	}
	closeCtx, closeCancel := context.WithCancel(context.Background())
	return &DirectExecutor{
		clusterID:   clusterID,
		im:          im,
		registry:    registry,
		genKey:      genKey,
		closeCtx:    closeCtx,
		closeCancel: closeCancel,
	}
}

func (d *DirectExecutor) ClusterID() string    { return d.clusterID }
func (d *DirectExecutor) Mode() ConnectionMode { return ModeDirect }

func (d *DirectExecutor) State(ctx context.Context) ConnectionState {
	if d.invalidated.Load() || d.im == nil || !d.im.IsRunning() {
		return StateDisconnected
	}
	return d.Capabilities(ctx).ConnectionState
}

func (d *DirectExecutor) Capabilities(ctx context.Context) ClusterCapabilities {
	return d.getOrProbeCapabilities(ctx, false)
}

// RefreshCapabilities bypasses the cache TTL and reconciles live InformerManager resources.
func (d *DirectExecutor) RefreshCapabilities(ctx context.Context) ClusterCapabilities {
	return d.getOrProbeCapabilities(ctx, true)
}

func (d *DirectExecutor) getOrProbeCapabilities(ctx context.Context, forceRefresh bool) ClusterCapabilities {
	if ctx != nil && ctx.Err() != nil {
		if !forceRefresh && d.registry != nil && !d.invalidated.Load() {
			if cached, ok := d.registry.GetForGeneration(d.clusterID, d.genKey); ok {
				return cached
			}
		}
		return ephemeralCanceledCapabilities(d.clusterID, ctx.Err())
	}

	if d.invalidated.Load() || d.im == nil || !d.im.IsRunning() {
		return disconnectedCapabilities(d.clusterID, "Direct informer manager is disconnected or invalidated")
	}

	if !forceRefresh {
		d.mu.Lock()
		ttl := directCapabilityCacheTTL
		if d.lastFailure {
			ttl = directFailureCacheTTL
		}
		fresh := !d.lastProbe.IsZero() && time.Since(d.lastProbe) < ttl
		d.mu.Unlock()

		if fresh && d.registry != nil {
			if cached, ok := d.registry.GetForGeneration(d.clusterID, d.genKey); ok {
				return cached
			}
		}
	}

	for {
		d.probeMu.Lock()
		if d.inFlight != nil {
			call := d.inFlight
			d.probeMu.Unlock()

			if ctx == nil {
				<-call.done
			} else {
				select {
				case <-call.done:
				case <-ctx.Done():
					return ephemeralCanceledCapabilities(d.clusterID, ctx.Err())
				}
			}
			if forceRefresh {
				continue
			}
			return call.caps
		}

		// Re-check cache after acquiring probeMu in case another probe just finished.
		if !forceRefresh {
			d.mu.Lock()
			ttl := directCapabilityCacheTTL
			if d.lastFailure {
				ttl = directFailureCacheTTL
			}
			fresh := !d.lastProbe.IsZero() && time.Since(d.lastProbe) < ttl
			d.mu.Unlock()
			if fresh && d.registry != nil {
				if cached, ok := d.registry.GetForGeneration(d.clusterID, d.genKey); ok {
					d.probeMu.Unlock()
					return cached
				}
			}
		}

		call := &probeCall{done: make(chan struct{})}
		d.inFlight = call
		d.probeMu.Unlock()

		caps := d.runProbe(ctx)
		call.caps = caps

		d.probeMu.Lock()
		if d.inFlight == call {
			d.inFlight = nil
		}
		d.probeMu.Unlock()
		close(call.done)

		return caps
	}
}

func (d *DirectExecutor) runProbe(_ context.Context) ClusterCapabilities {
	probeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var caps ClusterCapabilities
	if d.im == nil {
		caps = ProbeDirectCapabilities(probeCtx, d.clusterID, nil, false)
	} else {
		caps = ProbeDirectCapabilities(probeCtx, d.clusterID, d.im.Clientset(), d.im.WatchSecrets())
		if !d.im.IsRunning() || d.invalidated.Load() {
			caps.ConnectionState = StateDisconnected
		}
	}

	if d.invalidated.Load() || d.im == nil || !d.im.IsRunning() {
		return caps
	}

	// Only reconcile informers when discovery succeeded, preserving healthy resources on transient 429/timeout.
	if caps.ConnectionState != StateDisconnected && len(caps.Resources) > 0 {
		merged := MergeReconciledAllowedResources(d.im.AllowedResources(), caps)
		d.im.ReconcileAllowedResources(merged)
		if mState := caps.Capabilities[CapMetrics].State; mState != CapTemporarilyUnavailable {
			d.im.SetMetricsAllowed(mState == CapSupportedWorking)
		}
	}

	if d.registry != nil {
		if stored := d.registry.SetIfGeneration(d.clusterID, d.genKey, caps); !stored {
			// Executor was evicted or superseded by a newer generation while probing.
			caps.ConnectionState = StateDisconnected
			return caps
		}
	}

	d.mu.Lock()
	d.lastProbe = time.Now()
	d.lastFailure = isTransientOrDisconnected(caps)
	d.mu.Unlock()
	return caps
}

func isTransientOrDisconnected(caps ClusterCapabilities) bool {
	if caps.ConnectionState == StateDisconnected {
		return true
	}
	for _, st := range caps.Capabilities {
		if st.State == CapTemporarilyUnavailable {
			return true
		}
	}
	for _, st := range caps.Resources {
		if st.State == CapTemporarilyUnavailable {
			return true
		}
	}
	return false
}

func ephemeralCanceledCapabilities(clusterID string, err error) ClusterCapabilities {
	now := time.Now().UTC()
	caps := make(map[string]CapabilityStatus, len(allCapabilityKeys()))
	for _, k := range allCapabilityKeys() {
		caps[k] = CapabilityStatus{
			State:     CapTemporarilyUnavailable,
			Reason:    fmt.Sprintf("Capability probe canceled by caller: %v", err),
			CheckedAt: now,
		}
	}
	return ClusterCapabilities{
		ClusterID:       clusterID,
		ConnectionMode:  ModeDirect,
		ConnectionState: StateDegraded,
		StaleAfterSec:   120,
		Capabilities:    caps,
		Resources:       make(map[string]CapabilityStatus),
	}
}

func disconnectedCapabilities(clusterID, reason string) ClusterCapabilities {
	now := time.Now().UTC()
	caps := make(map[string]CapabilityStatus, len(allCapabilityKeys()))
	for _, k := range allCapabilityKeys() {
		caps[k] = CapabilityStatus{
			State:     CapTemporarilyUnavailable,
			Reason:    reason,
			CheckedAt: now,
		}
	}
	return ClusterCapabilities{
		ClusterID:       clusterID,
		ConnectionMode:  ModeDirect,
		ConnectionState: StateDisconnected,
		StaleAfterSec:   120,
		Capabilities:    caps,
		Resources:       make(map[string]CapabilityStatus),
	}
}

func (d *DirectExecutor) GetSnapshot(ctx context.Context) (*SnapshotResponse, error) {
	if d.invalidated.Load() || d.im == nil || !d.im.IsRunning() {
		return nil, fmt.Errorf("%w: direct informer manager for cluster %s is not running", ErrClusterDisconnected, d.clusterID)
	}

	caps := d.Capabilities(ctx)
	if d.invalidated.Load() || !d.im.IsRunning() {
		return nil, fmt.Errorf("%w: direct executor for cluster %s was stopped or evicted", ErrClusterDisconnected, d.clusterID)
	}
	if caps.ConnectionState == StateDisconnected {
		reason := "Kubernetes API server unreachable"
		if top, ok := caps.Capabilities[CapTopology]; ok && top.Reason != "" {
			reason = top.Reason
		}
		return nil, fmt.Errorf("%w: %s", ErrClusterUnreachable, reason)
	}

	snapCtx, cancel := withBoundedTimeout(ctx, 3*time.Second)
	defer cancel()

	pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets := d.im.GetSnapshotWithContext(snapCtx)

	if d.invalidated.Load() || !d.im.IsRunning() {
		return nil, fmt.Errorf("%w: direct executor for cluster %s invalidated during snapshot read", ErrClusterDisconnected, d.clusterID)
	}

	var lastSync *time.Time
	if ts := d.im.LastSyncAt(); !ts.IsZero() {
		t := ts.UTC()
		lastSync = &t
	}

	return &SnapshotResponse{
		ClusterID:              d.clusterID,
		ConnectionMode:         ModeDirect,
		ConnectionState:        caps.ConnectionState,
		LastSyncAt:             lastSync,
		StaleAfterSec:          120,
		Capabilities:           caps,
		Pods:                   pods,
		Nodes:                  nodes,
		Services:               services,
		Deployments:            deployments,
		ReplicaSets:            replicaSets,
		StatefulSets:           statefulSets,
		DaemonSets:             daemonSets,
		Ingresses:              ingresses,
		Incidents:              incidents,
		CronJobs:               cronJobs,
		Jobs:                   jobs,
		PVCs:                   pvcs,
		PVs:                    pvs,
		ConfigMaps:             configMaps,
		Secrets:                secrets,
		HPAs:                   d.im.GetHPASnapshot(),
		NetworkPolicies:        d.im.GetNetworkPolicySnapshot(),
		PDBs:                   d.im.GetPDBSnapshot(),
		ResourceQuotas:         d.im.GetResourceQuotaSnapshot(),
		LimitRanges:            d.im.GetLimitRangeSnapshot(),
		VolumeSnapshots:        d.im.GetVolumeSnapshotsSnapshot(),
		VolumeSnapshotContents: d.im.GetVolumeSnapshotContentsSnapshot(),
		ServiceAccounts:        d.im.GetServiceAccountsSnapshot(),
		RoleBindings:           d.im.GetRoleBindingsSnapshot(),
		ClusterRoleBindings:    d.im.GetClusterRoleBindingsSnapshot(),
		Roles:                  d.im.GetRolesSnapshot(),
		ClusterRoles:           d.im.GetClusterRolesSnapshot(),
		MetricsHistory:         d.im.GetMetricsHistory(),
	}, nil
}

func (d *DirectExecutor) CheckPDBSafety(_ context.Context, _ PDBCheckRequest) (*PDBCheckResult, error) {
	return nil, fmt.Errorf("%w: CheckPDBSafety migration is scheduled for a subsequent executor slice", ErrCapabilityUnsupported)
}

func (d *DirectExecutor) ExecuteOperation(_ context.Context, _ ClusterCommand) (*CommandResult, error) {
	return nil, fmt.Errorf("%w: ExecuteOperation migration is scheduled for a subsequent executor slice", ErrCapabilityUnsupported)
}

func (d *DirectExecutor) Close() error {
	d.invalidated.Store(true)
	if d.closeCancel != nil {
		d.closeCancel()
	}
	return nil
}
