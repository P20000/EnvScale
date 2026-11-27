package executor

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

const ssarWorkerLimit = 4

type resourceProbeSpec struct {
	key      string
	group    string
	resource string
	verbs    []string
	optional bool
}

var discoveryResourceSpecs = []resourceProbeSpec{
	{key: "core/v1/pods", group: "", resource: "pods", verbs: []string{"list", "watch"}},
	{key: "core/v1/nodes", group: "", resource: "nodes", verbs: []string{"list", "watch"}},
	{key: "core/v1/services", group: "", resource: "services", verbs: []string{"list", "watch"}},
	{key: "core/v1/events", group: "", resource: "events", verbs: []string{"list", "watch"}},
	{key: "core/v1/configmaps", group: "", resource: "configmaps", verbs: []string{"list", "watch"}},
	{key: "core/v1/secrets", group: "", resource: "secrets", verbs: []string{"list", "watch"}},
	{key: "core/v1/persistentvolumeclaims", group: "", resource: "persistentvolumeclaims", verbs: []string{"list", "watch"}},
	{key: "core/v1/persistentvolumes", group: "", resource: "persistentvolumes", verbs: []string{"list", "watch"}},
	{key: "core/v1/resourcequotas", group: "", resource: "resourcequotas", verbs: []string{"list", "watch"}},
	{key: "core/v1/limitranges", group: "", resource: "limitranges", verbs: []string{"list", "watch"}},
	{key: "core/v1/serviceaccounts", group: "", resource: "serviceaccounts", verbs: []string{"list", "watch"}},
	{key: "apps/v1/deployments", group: "apps", resource: "deployments", verbs: []string{"list", "watch"}},
	{key: "apps/v1/replicasets", group: "apps", resource: "replicasets", verbs: []string{"list", "watch"}},
	{key: "apps/v1/statefulsets", group: "apps", resource: "statefulsets", verbs: []string{"list", "watch"}},
	{key: "apps/v1/daemonsets", group: "apps", resource: "daemonsets", verbs: []string{"list", "watch"}},
	{key: "batch/v1/jobs", group: "batch", resource: "jobs", verbs: []string{"list", "watch"}},
	{key: "batch/v1/cronjobs", group: "batch", resource: "cronjobs", verbs: []string{"list", "watch"}},
	{key: "networking.k8s.io/v1/ingresses", group: "networking.k8s.io", resource: "ingresses", verbs: []string{"list", "watch"}},
	{key: "networking.k8s.io/v1/networkpolicies", group: "networking.k8s.io", resource: "networkpolicies", verbs: []string{"list", "watch"}},
	{key: "autoscaling/v2/horizontalpodautoscalers", group: "autoscaling", resource: "horizontalpodautoscalers", verbs: []string{"list", "watch"}},
	{key: "policy/v1/poddisruptionbudgets", group: "policy", resource: "poddisruptionbudgets", verbs: []string{"list", "watch"}},
	{key: "rbac.authorization.k8s.io/v1/roles", group: "rbac.authorization.k8s.io", resource: "roles", verbs: []string{"list", "watch"}},
	{key: "rbac.authorization.k8s.io/v1/rolebindings", group: "rbac.authorization.k8s.io", resource: "rolebindings", verbs: []string{"list", "watch"}},
	{key: "rbac.authorization.k8s.io/v1/clusterroles", group: "rbac.authorization.k8s.io", resource: "clusterroles", verbs: []string{"list", "watch"}},
	{key: "rbac.authorization.k8s.io/v1/clusterrolebindings", group: "rbac.authorization.k8s.io", resource: "clusterrolebindings", verbs: []string{"list", "watch"}},
	{key: "snapshot.storage.k8s.io/v1/volumesnapshots", group: "snapshot.storage.k8s.io", resource: "volumesnapshots", verbs: []string{"list", "watch"}, optional: true},
	{key: "snapshot.storage.k8s.io/v1/volumesnapshotcontents", group: "snapshot.storage.k8s.io", resource: "volumesnapshotcontents", verbs: []string{"list", "watch"}, optional: true},
}

type registryEntry struct {
	generation string
	caps       ClusterCapabilities
}

// ClusterCapabilityRegistry tracks current ClusterCapabilities per cluster UUID with generation fencing.
type ClusterCapabilityRegistry struct {
	mu                sync.RWMutex
	activeGenerations map[string]string
	entries           map[string]registryEntry
}

// NewClusterCapabilityRegistry constructs an empty capability registry.
func NewClusterCapabilityRegistry() *ClusterCapabilityRegistry {
	return &ClusterCapabilityRegistry{
		activeGenerations: make(map[string]string),
		entries:           make(map[string]registryEntry),
	}
}

// RegisterGeneration binds clusterID to the specified executor/session generation
// and evicts any prior generation's cached capabilities.
func (r *ClusterCapabilityRegistry) RegisterGeneration(clusterID, generation string) {
	if clusterID == "" || generation == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if prev, ok := r.activeGenerations[clusterID]; ok && prev == generation {
		return
	}
	r.activeGenerations[clusterID] = generation
	delete(r.entries, clusterID)
}

// Set stores capabilities for direct test setup without explicit generation fencing.
func (r *ClusterCapabilityRegistry) Set(clusterID string, caps ClusterCapabilities) {
	if clusterID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	gen := r.activeGenerations[clusterID]
	r.entries[clusterID] = registryEntry{generation: gen, caps: caps}
}

// SetIfGeneration stores capabilities only if generation still matches the active registered generation.
// Prevents stale in-flight probes from overwriting evicted or re-registered executors.
func (r *ClusterCapabilityRegistry) SetIfGeneration(clusterID, generation string, caps ClusterCapabilities) bool {
	if clusterID == "" || generation == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	active, ok := r.activeGenerations[clusterID]
	if !ok || active != generation {
		return false
	}
	r.entries[clusterID] = registryEntry{generation: generation, caps: caps}
	return true
}

// Get retrieves cached capabilities strictly for clusterID.
func (r *ClusterCapabilityRegistry) Get(clusterID string) (ClusterCapabilities, bool) {
	if clusterID == "" {
		return ClusterCapabilities{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	entry, ok := r.entries[clusterID]
	if !ok {
		return ClusterCapabilities{}, false
	}
	return entry.caps, true
}

// GetForGeneration retrieves cached capabilities only if generation still owns clusterID.
func (r *ClusterCapabilityRegistry) GetForGeneration(clusterID, generation string) (ClusterCapabilities, bool) {
	if clusterID == "" || generation == "" {
		return ClusterCapabilities{}, false
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.activeGenerations[clusterID] != generation {
		return ClusterCapabilities{}, false
	}
	entry, ok := r.entries[clusterID]
	if !ok || entry.generation != generation {
		return ClusterCapabilities{}, false
	}
	return entry.caps, true
}

// Delete removes clusterID and invalidates its active generation in the registry.
func (r *ClusterCapabilityRegistry) Delete(clusterID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.activeGenerations, clusterID)
	delete(r.entries, clusterID)
}

// Clear empties the entire capability registry and invalidates all active generations.
func (r *ClusterCapabilityRegistry) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.activeGenerations = make(map[string]string)
	r.entries = make(map[string]registryEntry)
}

// AllowedResourceMap returns the subset of discovered resources that are supported and working.
func AllowedResourceMap(caps ClusterCapabilities) map[string]bool {
	allowed := make(map[string]bool)
	for key, status := range caps.Resources {
		if status.State == CapSupportedWorking {
			allowed[key] = true
		}
	}
	return allowed
}

// MergeReconciledAllowedResources reconciles previous allowed resources with a new capability probe
// without revoking previously healthy resources when a probe experiences a transient error
// (CapTemporarilyUnavailable / 429 / timeout). Explicit denials/unavailability still revoke access.
func MergeReconciledAllowedResources(prev map[string]bool, caps ClusterCapabilities) map[string]bool {
	if caps.ConnectionState == StateDisconnected || len(caps.Resources) == 0 {
		if prev == nil {
			return nil
		}
		cp := make(map[string]bool, len(prev))
		for k, v := range prev {
			cp[k] = v
		}
		return cp
	}
	next := make(map[string]bool, len(caps.Resources))
	for key, status := range caps.Resources {
		switch status.State {
		case CapSupportedWorking:
			next[key] = true
		case CapTemporarilyUnavailable:
			if prev == nil || prev[key] {
				next[key] = true
			}
		case CapPermissionDenied, CapClusterUnavailable, CapNotImplemented:
			next[key] = false
		}
	}
	return next
}

func probeSSAR(ctx context.Context, clientset kubernetes.Interface, throttled *atomic.Bool, group, resource, subresource, verb string, now time.Time) CapabilityStatus {
	if err := ctx.Err(); err != nil {
		return CapabilityStatus{
			State:     CapTemporarilyUnavailable,
			Reason:    fmt.Sprintf("Capability probe canceled or timed out for %s/%s (%s): %v", group, resource, verb, err),
			CheckedAt: now,
		}
	}
	if throttled != nil && throttled.Load() {
		return CapabilityStatus{
			State:     CapTemporarilyUnavailable,
			Reason:    fmt.Sprintf("Skipped SSAR for %s/%s (%s): Kubernetes API server rate-limited probe", group, resource, verb),
			CheckedAt: now,
		}
	}
	sar := &authorizationv1.SelfSubjectAccessReview{
		Spec: authorizationv1.SelfSubjectAccessReviewSpec{
			ResourceAttributes: &authorizationv1.ResourceAttributes{
				Group:       group,
				Resource:    resource,
				Subresource: subresource,
				Verb:        verb,
			},
		},
	}
	resp, err := clientset.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, sar, metav1.CreateOptions{})
	if err != nil {
		if throttled != nil && apierrors.IsTooManyRequests(err) {
			throttled.Store(true)
		}
		return CapabilityStatus{
			State:     CapTemporarilyUnavailable,
			Reason:    fmt.Sprintf("SelfSubjectAccessReview failed for %s/%s (%s): %v", group, resource, verb, err),
			CheckedAt: now,
		}
	}
	if !resp.Status.Allowed {
		reason := resp.Status.Reason
		if reason == "" {
			reason = fmt.Sprintf("Kubernetes RBAC denied %s on %s", verb, resource)
		}
		return CapabilityStatus{
			State:     CapPermissionDenied,
			Reason:    reason,
			CheckedAt: now,
			Details:   map[string]any{"verb": verb, "resource": resource, "group": group},
		}
	}
	return CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
}

func checkResourceVerbs(ctx context.Context, clientset kubernetes.Interface, throttled *atomic.Bool, group, resource string, verbs []string, now time.Time) CapabilityStatus {
	for _, verb := range verbs {
		st := probeSSAR(ctx, clientset, throttled, group, resource, "", verb, now)
		if st.State != CapSupportedWorking {
			return st
		}
	}
	return CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
}

func serverGroupsWithContext(ctx context.Context, clientset kubernetes.Interface) (*metav1.APIGroupList, error) {
	type res struct {
		groups *metav1.APIGroupList
		err    error
	}
	ch := make(chan res, 1)
	go func() {
		g, err := clientset.Discovery().ServerGroups()
		ch <- res{groups: g, err: err}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-ch:
		return r.groups, r.err
	}
}

// ProbeDirectCapabilities performs context-bounded API discovery + worker-pooled SelfSubjectAccessReview probing.
// SSAR is retained as the authoritative RBAC check (never trusting incomplete SelfSubjectRulesReview responses).
func ProbeDirectCapabilities(ctx context.Context, clusterID string, clientset kubernetes.Interface, watchSecrets bool) ClusterCapabilities {
	now := time.Now().UTC()
	out := ClusterCapabilities{
		ClusterID:       clusterID,
		ConnectionMode:  ModeDirect,
		ConnectionState: StateDisconnected,
		StaleAfterSec:   120,
		Capabilities:    make(map[string]CapabilityStatus),
		Resources:       make(map[string]CapabilityStatus),
	}

	if clientset == nil {
		for _, capKey := range allCapabilityKeys() {
			out.Capabilities[capKey] = CapabilityStatus{
				State:     CapTemporarilyUnavailable,
				Reason:    "Kubernetes clientset is not initialized",
				CheckedAt: now,
			}
		}
		return out
	}

	probeCtx, cancel := withBoundedTimeout(ctx, 5*time.Second)
	defer cancel()

	groupList, err := serverGroupsWithContext(probeCtx, clientset)
	if err != nil || probeCtx.Err() != nil {
		reason := fmt.Sprintf("Kubernetes API discovery failed: %v", err)
		if err == nil {
			reason = fmt.Sprintf("Kubernetes API discovery timed out: %v", probeCtx.Err())
		}
		for _, capKey := range allCapabilityKeys() {
			out.Capabilities[capKey] = CapabilityStatus{
				State:     CapTemporarilyUnavailable,
				Reason:    reason,
				CheckedAt: now,
			}
		}
		return out
	}

	presentGroups := map[string]bool{"": true}
	if groupList != nil {
		for _, g := range groupList.Groups {
			presentGroups[g.Name] = true
		}
	}

	var throttled atomic.Bool
	type resOutcome struct {
		spec   resourceProbeSpec
		status CapabilityStatus
	}
	outcomes := make([]resOutcome, len(discoveryResourceSpecs))
	jobs := make(chan int, len(discoveryResourceSpecs))
	var wg sync.WaitGroup

	for w := 0; w < ssarWorkerLimit; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				spec := discoveryResourceSpecs[idx]
				if spec.key == "core/v1/secrets" && !watchSecrets {
					outcomes[idx] = resOutcome{
						spec: spec,
						status: CapabilityStatus{
							State:     CapPermissionDenied,
							Reason:    "Kubernetes Secret reads disabled by default security policy (SEC-L3)",
							CheckedAt: now,
						},
					}
					continue
				}
				if !presentGroups[spec.group] {
					outcomes[idx] = resOutcome{
						spec: spec,
						status: CapabilityStatus{
							State:     CapClusterUnavailable,
							Reason:    fmt.Sprintf("API group %q is not installed on this cluster", spec.group),
							CheckedAt: now,
						},
					}
					continue
				}
				st := checkResourceVerbs(probeCtx, clientset, &throttled, spec.group, spec.resource, spec.verbs, now)
				outcomes[idx] = resOutcome{spec: spec, status: st}
			}
		}()
	}

	for i := range discoveryResourceSpecs {
		jobs <- i
	}
	close(jobs)
	wg.Wait()

	hasCoreDegradation := false
	for _, item := range outcomes {
		out.Resources[item.spec.key] = item.status
		if !item.spec.optional && item.spec.key != "core/v1/secrets" && item.status.State != CapSupportedWorking {
			hasCoreDegradation = true
		}
	}

	// Probe high-level operational capabilities in parallel while respecting worker limit / throttling.
	var (
		podsLogSt   CapabilityStatus
		metricsSt   CapabilityStatus
		podDelSt    CapabilityStatus
		depScaleSt  CapabilityStatus
		depUpdateSt CapabilityStatus
		capWG       sync.WaitGroup
	)
	podsSt := out.Resources["core/v1/pods"]
	if podsSt.State == CapSupportedWorking {
		out.Capabilities[CapTopology] = CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
	} else {
		out.Capabilities[CapTopology] = podsSt
		hasCoreDegradation = true
	}
	out.Capabilities[CapEvents] = out.Resources["core/v1/events"]
	out.Capabilities[CapPDBValidation] = out.Resources["policy/v1/poddisruptionbudgets"]

	capWG.Add(4)
	go func() {
		defer capWG.Done()
		if podsSt.State == CapSupportedWorking {
			podsLogSt = probeSSAR(probeCtx, clientset, &throttled, "", "pods", "log", "get", now)
		} else {
			podsLogSt = podsSt
		}
	}()
	go func() {
		defer capWG.Done()
		if !presentGroups["metrics.k8s.io"] {
			metricsSt = CapabilityStatus{
				State:     CapClusterUnavailable,
				Reason:    "metrics-server API (metrics.k8s.io) is not installed on this cluster",
				CheckedAt: now,
			}
			return
		}
		podM := checkResourceVerbs(probeCtx, clientset, &throttled, "metrics.k8s.io", "pods", []string{"get", "list"}, now)
		if podM.State != CapSupportedWorking {
			metricsSt = podM
			return
		}
		nodeM := checkResourceVerbs(probeCtx, clientset, &throttled, "metrics.k8s.io", "nodes", []string{"get", "list"}, now)
		metricsSt = nodeM
	}()
	go func() {
		defer capWG.Done()
		podDelSt = probeSSAR(probeCtx, clientset, &throttled, "", "pods", "", "delete", now)
		depScaleSt = probeSSAR(probeCtx, clientset, &throttled, "apps", "deployments", "scale", "patch", now)
	}()
	go func() {
		defer capWG.Done()
		depUpdateSt = probeSSAR(probeCtx, clientset, &throttled, "apps", "deployments", "", "update", now)
	}()
	capWG.Wait()

	out.Capabilities[CapLogs] = podsLogSt
	out.Capabilities[CapMetrics] = metricsSt
	out.Capabilities[CapResourceDelete] = podDelSt
	out.Capabilities[CapChaosPodCrash] = podDelSt
	out.Capabilities[CapDeploymentScale] = depScaleSt
	out.Capabilities[CapDeploymentRollback] = depUpdateSt
	out.Capabilities[CapChaosScaleDown] = depUpdateSt
	out.Capabilities[CapResourceApply] = CapabilityStatus{
		State:     CapNotImplemented,
		Reason:    "Declarative apply via unified executor is scheduled for a subsequent migration phase",
		CheckedAt: now,
	}
	out.Capabilities[CapChaosOOMPressure] = CapabilityStatus{
		State:     CapNotImplemented,
		Reason:    "OOM pressure chaos is deferred until deterministic recovery tests pass",
		CheckedAt: now,
	}

	if hasCoreDegradation || out.Capabilities[CapLogs].State != CapSupportedWorking || out.Capabilities[CapMetrics].State != CapSupportedWorking {
		out.ConnectionState = StateDegraded
	} else {
		out.ConnectionState = StateConnected
	}
	return out
}

// BuildAgentCapabilities constructs ClusterCapabilities from AgentRegistry metadata
// without overclaiming unverified RBAC or unsupported protocol v1 capabilities.
func BuildAgentCapabilities(clusterID string, meta k8s.AgentClusterMeta) ClusterCapabilities {
	now := time.Now().UTC()
	out := ClusterCapabilities{
		ClusterID:       clusterID,
		ConnectionMode:  ModeAgent,
		ProtocolVersion: meta.ProtocolVersion,
		AgentVersion:    meta.AgentVersion,
		StaleAfterSec:   120,
		Capabilities:    make(map[string]CapabilityStatus),
		Resources:       make(map[string]CapabilityStatus, len(discoveryResourceSpecs)),
	}
	if !meta.LastSeen.IsZero() {
		ts := meta.LastSeen.UTC()
		out.LastSyncAt = &ts
	}

	var connReason string
	switch {
	case !meta.Connected && !meta.EverSynced:
		out.ConnectionState = StateWaitingForAgent
		connReason = fmt.Sprintf("Waiting for initial snapshot from agent for cluster %s", clusterID)
	case !meta.Connected && meta.EverSynced:
		out.ConnectionState = StateDisconnected
		connReason = fmt.Sprintf("Agent for cluster %s is disconnected", clusterID)
	case meta.Connected && !meta.HasSnapshot && meta.EverSynced:
		out.ConnectionState = StateReconnecting
		connReason = fmt.Sprintf("Agent for cluster %s reconnected; waiting for fresh baseline snapshot from active session", clusterID)
	case meta.Connected && !meta.HasSnapshot && !meta.EverSynced:
		out.ConnectionState = StateWaitingForAgent
		connReason = fmt.Sprintf("Agent for cluster %s connected; waiting for initial baseline snapshot", clusterID)
	default:
		out.ConnectionState = StateConnected
	}

	for _, spec := range discoveryResourceSpecs {
		if spec.key == "core/v1/secrets" {
			out.Resources[spec.key] = CapabilityStatus{
				State:     CapPermissionDenied,
				Reason:    "Default Agent profile excludes Kubernetes Secret reads (SEC-L3)",
				CheckedAt: now,
			}
			continue
		}
		if out.ConnectionState != StateConnected {
			if spec.optional {
				out.Resources[spec.key] = CapabilityStatus{
					State:     CapNotImplemented,
					Reason:    "Agent protocol v1.0 does not report optional CRD discovery prior to sync",
					CheckedAt: now,
				}
			} else {
				out.Resources[spec.key] = CapabilityStatus{
					State:     CapTemporarilyUnavailable,
					Reason:    connReason,
					CheckedAt: now,
				}
			}
			continue
		}
		if meta.SyncedResources[spec.key] {
			out.Resources[spec.key] = CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
		} else if spec.optional {
			out.Resources[spec.key] = CapabilityStatus{
				State:     CapNotImplemented,
				Reason:    "Agent protocol v1.0 snapshot did not populate this optional CRD resource",
				CheckedAt: now,
			}
		} else {
			out.Resources[spec.key] = CapabilityStatus{
				State:     CapTemporarilyUnavailable,
				Reason:    "Not populated in Agent v1 snapshot; resource permissions or availability unverified",
				CheckedAt: now,
			}
		}
	}

	if out.ConnectionState != StateConnected {
		for _, capKey := range allCapabilityKeys() {
			if capKey == CapChaosOOMPressure || capKey == CapResourceApply {
				out.Capabilities[capKey] = CapabilityStatus{State: CapNotImplemented, Reason: "Deferred feature", CheckedAt: now}
				continue
			}
			out.Capabilities[capKey] = CapabilityStatus{State: CapTemporarilyUnavailable, Reason: connReason, CheckedAt: now}
		}
		return out
	}

	out.Capabilities[CapTopology] = out.Resources["core/v1/pods"]
	if out.Capabilities[CapTopology].State != CapSupportedWorking && meta.HasSnapshot {
		// Allow topology reporting when snapshot delivered non-nil workloads (e.g. Deployments) even if cluster had no pods.
		out.Capabilities[CapTopology] = CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
	}
	out.Capabilities[CapEvents] = out.Resources["core/v1/events"]

	v1Msg := "Agent protocol v1.0 supports snapshot discovery only; upgrade agent/protocol v2.0 for logs, metrics, and remote operations"
	for _, capKey := range []string{
		CapLogs, CapMetrics, CapResourceDelete, CapResourceApply,
		CapDeploymentScale, CapDeploymentRollback, CapChaosPodCrash, CapChaosScaleDown, CapPDBValidation,
	} {
		out.Capabilities[capKey] = CapabilityStatus{State: CapNotImplemented, Reason: v1Msg, CheckedAt: now}
	}
	out.Capabilities[CapChaosOOMPressure] = CapabilityStatus{
		State:     CapNotImplemented,
		Reason:    "OOM pressure chaos is deferred until deterministic recovery tests pass",
		CheckedAt: now,
	}
	return out
}

func allCapabilityKeys() []string {
	return []string{
		CapTopology, CapLogs, CapMetrics, CapEvents,
		CapResourceDelete, CapResourceApply, CapDeploymentScale,
		CapDeploymentRollback, CapChaosPodCrash, CapChaosScaleDown,
		CapChaosOOMPressure, CapPDBValidation,
	}
}

func withBoundedTimeout(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	if ctx == nil {
		return context.WithTimeout(context.Background(), d)
	}
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, d)
}
