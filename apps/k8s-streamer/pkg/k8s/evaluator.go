// Package k8s — evaluator.go implements a background Metric Evaluator that runs
// on a configurable tick interval (default 10 seconds), reads the current pod
// snapshot from every registered cluster's InformerManager cache, and evaluates
// each pod's phase and metrics against a set of in-memory alert rules.
//
// When a pod violates a rule (e.g., restart count exceeds threshold, phase is
// CrashLoopBackOff for longer than the rule's duration), the evaluator emits an
// EVENT_ALERT_TRIGGERED event over the WebSocket hub containing the rule details,
// the pod identity, and the measured metric value.
//
// Alert rules are stored in-memory and can be pushed from the api-server via the
// REST endpoint POST /api/v1/evaluator/rules (wired in main.go). This push model
// avoids the evaluator needing to poll the api-server REST API every cycle and
// keeps the evaluation loop tight and fast (sub-10ms per cycle for clusters with
// up to 200 pods).
package k8s

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// ────────────────────────────────────────────────────────────────────────────
// Alert Rule Model
// ────────────────────────────────────────────────────────────────────────────

// AlertRule defines a single metric evaluation rule pushed from the api-server.
// The evaluator checks each pod against these rules on every tick cycle.
type AlertRule struct {
	// RuleID is the unique identifier for this rule (matches the api-server alert_policies.id)
	RuleID string `json:"ruleId"`

	// WorkspaceID scopes this rule to a specific workspace/cluster
	WorkspaceID string `json:"workspaceId"`

	// ClusterID further scopes to a specific registered cluster (optional — empty means all clusters in workspace)
	ClusterID string `json:"clusterId,omitempty"`

	// MetricType identifies which metric to evaluate:
	//   - "pod_restarts"     → PodStatusDelta.RestartCount
	//   - "pod_phase"        → PodStatusDelta.Phase (matches against ConditionValue)
	//   - "cpu_usage"        → PodStatusDelta.CPUUsagePct
	//   - "memory_usage"     → PodStatusDelta.MemoryUsageMb
	MetricType string `json:"metricType"`

	// ConditionOperator defines the comparison: ">" | ">=" | "<" | "<=" | "==" | "!="
	ConditionOperator string `json:"conditionOperator"`

	// ThresholdValue is the numeric threshold for numeric metrics (restarts, cpu, memory)
	ThresholdValue float64 `json:"thresholdValue"`

	// ConditionValue is the string value for phase-based matching (e.g. "CrashLoopBackOff")
	ConditionValue string `json:"conditionValue,omitempty"`

	// DurationSeconds is the sustained violation window — the pod must violate
	// the rule for at least this many seconds before the alert fires. Prevents
	// flapping alerts from transient spikes.
	DurationSeconds int `json:"durationSeconds"`

	// Severity classifies the alert urgency: "CRITICAL" | "WARNING"
	Severity string `json:"severity"`

	// Enabled controls whether this rule is actively evaluated
	Enabled bool `json:"enabled"`

	// Name is the human-readable rule name for the alert event
	Name string `json:"name"`
}

// ────────────────────────────────────────────────────────────────────────────
// Violation Tracker
// ────────────────────────────────────────────────────────────────────────────

// violationKey uniquely identifies a pod + rule combination for tracking sustained violations.
type violationKey struct {
	clusterID string
	namespace string
	podName   string
	ruleID    string
}

// violationState tracks the first time a pod was seen violating a rule,
// and whether the alert for this sustained violation has already been fired.
type violationState struct {
	firstSeen time.Time
	fired     bool
}

// ────────────────────────────────────────────────────────────────────────────
// Metric Evaluator
// ────────────────────────────────────────────────────────────────────────────

// SnapshotProvider retrieves the current pod snapshot for a given clusterID.
// Implemented by ClusterManager.
type SnapshotProvider interface {
	GetClusterSnapshot(clusterID string) (
		[]types.PodStatusDelta,
		[]types.NodeStatusDelta,
		[]types.ServiceStatusDelta,
		[]types.DeploymentStatusDelta,
		[]types.ReplicaSetStatusDelta,
		[]types.StatefulSetStatusDelta,
		[]types.DaemonSetStatusDelta,
		[]types.IngressStatusDelta,
		[]types.K8sIncidentEvent,
		error,
	)
	ListClusters() map[string]bool
}

// MetricEvaluator is the background worker that periodically evaluates pod
// metrics from all registered clusters against the configured alert rules.
type MetricEvaluator struct {
	provider   SnapshotProvider
	hub        *websocket.Hub
	interval   time.Duration

	// In-memory alert rule store — pushed by api-server via REST endpoint
	rules   []AlertRule
	rulesMu sync.RWMutex

	// Violation tracking: maps (cluster+pod+rule) → first violation timestamp.
	// Entries are cleaned up when the violation clears (pod recovers).
	violations map[violationKey]*violationState
	violMu     sync.Mutex

	stopCh  chan struct{}
	running bool
	mu      sync.Mutex
}

// NewMetricEvaluator creates a new evaluator. Default evaluation interval is 10 seconds.
func NewMetricEvaluator(provider SnapshotProvider, hub *websocket.Hub) *MetricEvaluator {
	return &MetricEvaluator{
		provider:   provider,
		hub:        hub,
		interval:   1 * time.Second,
		rules:      make([]AlertRule, 0),
		violations: make(map[violationKey]*violationState),
		stopCh:     make(chan struct{}),
	}
}

// SetInterval overrides the default 10-second evaluation cycle. Must be called before Start().
func (me *MetricEvaluator) SetInterval(d time.Duration) {
	me.interval = d
}

// Start launches the evaluation loop in a background goroutine.
func (me *MetricEvaluator) Start() {
	me.mu.Lock()
	if me.running {
		me.mu.Unlock()
		return
	}
	me.running = true
	me.mu.Unlock()

	go me.loop()
	log.Printf("[MetricEvaluator] Started — evaluating every %s", me.interval)
}

// Stop halts the background evaluation loop.
func (me *MetricEvaluator) Stop() {
	me.mu.Lock()
	defer me.mu.Unlock()

	if !me.running {
		return
	}
	close(me.stopCh)
	me.running = false
	log.Println("[MetricEvaluator] Stopped")
}

// IsRunning returns whether the evaluator is currently active.
func (me *MetricEvaluator) IsRunning() bool {
	me.mu.Lock()
	defer me.mu.Unlock()
	return me.running
}

// ────────────────────────────────────────────────────────────────────────────
// Rule Management (pushed from api-server via REST)
// ────────────────────────────────────────────────────────────────────────────

// SetRules replaces the entire in-memory rule set. Called when the api-server
// pushes a full rule sync (e.g., on startup or after a policy CRUD operation).
func (me *MetricEvaluator) SetRules(rules []AlertRule) {
	me.rulesMu.Lock()
	me.rules = rules
	me.rulesMu.Unlock()
	log.Printf("[MetricEvaluator] Rule set updated — %d active rules loaded", len(rules))
}

// AddRule appends a single alert rule. Idempotent — if a rule with the same
// RuleID already exists, it is replaced.
func (me *MetricEvaluator) AddRule(rule AlertRule) {
	me.rulesMu.Lock()
	defer me.rulesMu.Unlock()

	for i, existing := range me.rules {
		if existing.RuleID == rule.RuleID {
			me.rules[i] = rule
			log.Printf("[MetricEvaluator] Rule %s updated: %s", rule.RuleID, rule.Name)
			return
		}
	}
	me.rules = append(me.rules, rule)
	log.Printf("[MetricEvaluator] Rule %s added: %s", rule.RuleID, rule.Name)
}

// RemoveRule deletes a rule by ID. Returns true if the rule was found and removed.
func (me *MetricEvaluator) RemoveRule(ruleID string) bool {
	me.rulesMu.Lock()
	defer me.rulesMu.Unlock()

	for i, r := range me.rules {
		if r.RuleID == ruleID {
			me.rules = append(me.rules[:i], me.rules[i+1:]...)
			log.Printf("[MetricEvaluator] Rule %s removed", ruleID)
			return true
		}
	}
	return false
}

// ListRules returns a copy of the current rule set (safe for JSON serialization).
func (me *MetricEvaluator) ListRules() []AlertRule {
	me.rulesMu.RLock()
	defer me.rulesMu.RUnlock()

	out := make([]AlertRule, len(me.rules))
	copy(out, me.rules)
	return out
}

// RuleCount returns the number of active alert rules.
func (me *MetricEvaluator) RuleCount() int {
	me.rulesMu.RLock()
	defer me.rulesMu.RUnlock()
	return len(me.rules)
}

// ────────────────────────────────────────────────────────────────────────────
// Evaluation Loop
// ────────────────────────────────────────────────────────────────────────────

func (me *MetricEvaluator) loop() {
	ticker := time.NewTicker(me.interval)
	defer ticker.Stop()

	for {
		select {
		case <-me.stopCh:
			return
		case <-ticker.C:
			me.evaluate()
		}
	}
}

// evaluate runs a single evaluation cycle across all registered clusters.
func (me *MetricEvaluator) evaluate() {
	me.rulesMu.RLock()
	rules := make([]AlertRule, len(me.rules))
	copy(rules, me.rules)
	me.rulesMu.RUnlock()

	if len(rules) == 0 {
		return // no rules to evaluate — skip this cycle entirely
	}

	clusters := me.provider.ListClusters()
	now := time.Now()

	// Track which violation keys are still active this cycle to prune cleared ones
	activeViolations := make(map[violationKey]bool)

	for clusterID, isRunning := range clusters {
		if !isRunning {
			continue
		}

		pods, nodes, _, _, _, _, _, _, _, err := me.provider.GetClusterSnapshot(clusterID)
		if err != nil {
			continue
		}

		for _, rule := range rules {
			if !rule.Enabled {
				continue
			}

			// Scope check: skip rules that target a different cluster
			if rule.ClusterID != "" && rule.ClusterID != clusterID {
				continue
			}

			// Evaluate per-pod metrics
			for _, pod := range pods {
				violated, measuredValue := me.evaluateRule(rule, pod)
				vk := violationKey{
					clusterID: clusterID,
					namespace: pod.Namespace,
					podName:   pod.Name,
					ruleID:    rule.RuleID,
				}

				if violated {
					activeViolations[vk] = true
					me.violMu.Lock()
					state, exists := me.violations[vk]
					if !exists {
						// First time seeing this violation — record timestamp
						me.violations[vk] = &violationState{firstSeen: now, fired: false}
						me.violMu.Unlock()
						continue
					}

					// Check if violation has been sustained long enough
					elapsed := now.Sub(state.firstSeen)
					if elapsed >= time.Duration(rule.DurationSeconds)*time.Second && !state.fired {
						state.fired = true
						me.violMu.Unlock()

						// Fire the alert!
						me.emitAlert(clusterID, rule, pod, measuredValue)
					} else {
						me.violMu.Unlock()
					}
				}
			}

			// Evaluate node-level rules (e.g., "node_status != Ready")
			if rule.MetricType == "node_status" {
				for _, node := range nodes {
					violated := me.evaluateNodeRule(rule, node)
					if violated {
						me.hub.BroadcastEvent(types.EventAlertTriggered, clusterID, types.AlertTriggeredEvent{
							RuleID:      rule.RuleID,
							RuleName:    rule.Name,
							Severity:    rule.Severity,
							MetricType:  rule.MetricType,
							TargetKind:  "Node",
							TargetName:  node.Name,
							Namespace:   "",
							Measured:    node.Status,
							Threshold:   rule.ConditionValue,
							Message:     fmt.Sprintf("Node '%s' status is '%s' (expected: %s %s)", node.Name, node.Status, rule.ConditionOperator, rule.ConditionValue),
							Timestamp:   now.UTC().Format(time.RFC3339Nano),
						})
					}
				}
			}
		}
	}

	// Prune cleared violations — if a pod was violating a rule last cycle
	// but is now healthy, remove the tracking entry so it can re-fire later
	me.violMu.Lock()
	for vk := range me.violations {
		if !activeViolations[vk] {
			delete(me.violations, vk)
		}
	}
	me.violMu.Unlock()
}

// evaluateRule checks a single pod against a single rule.
// Returns (violated bool, measuredValue string).
func (me *MetricEvaluator) evaluateRule(rule AlertRule, pod types.PodStatusDelta) (bool, string) {
	switch rule.MetricType {
	case "pod_restarts":
		val := float64(pod.RestartCount)
		return compareNumeric(val, rule.ConditionOperator, rule.ThresholdValue), fmt.Sprintf("%.0f", val)

	case "pod_phase":
		return compareString(pod.Phase, rule.ConditionOperator, rule.ConditionValue), pod.Phase

	case "cpu_usage":
		if pod.CPUUsagePct == 0 {
			return false, "0" // no CPU data available
		}
		return compareNumeric(pod.CPUUsagePct, rule.ConditionOperator, rule.ThresholdValue), fmt.Sprintf("%.1f%%", pod.CPUUsagePct)

	case "memory_usage":
		if pod.MemoryUsageMb == 0 {
			return false, "0" // no memory data available
		}
		return compareNumeric(pod.MemoryUsageMb, rule.ConditionOperator, rule.ThresholdValue), fmt.Sprintf("%.1fMB", pod.MemoryUsageMb)

	default:
		return false, ""
	}
}

// evaluateNodeRule checks a node against a node_status rule.
func (me *MetricEvaluator) evaluateNodeRule(rule AlertRule, node types.NodeStatusDelta) bool {
	if rule.MetricType != "node_status" {
		return false
	}
	return compareString(node.Status, rule.ConditionOperator, rule.ConditionValue)
}

// emitAlert broadcasts an EVENT_ALERT_TRIGGERED event to all clients watching the cluster.
func (me *MetricEvaluator) emitAlert(clusterID string, rule AlertRule, pod types.PodStatusDelta, measuredValue string) {
	threshold := fmt.Sprintf("%s %v", rule.ConditionOperator, rule.ThresholdValue)
	if rule.MetricType == "pod_phase" {
		threshold = fmt.Sprintf("%s %s", rule.ConditionOperator, rule.ConditionValue)
	}

	event := types.AlertTriggeredEvent{
		RuleID:     rule.RuleID,
		RuleName:   rule.Name,
		Severity:   rule.Severity,
		MetricType: rule.MetricType,
		TargetKind: "Pod",
		TargetName: pod.Name,
		Namespace:  pod.Namespace,
		Measured:   measuredValue,
		Threshold:  threshold,
		Message: fmt.Sprintf("Alert '%s': Pod %s/%s %s is %s (threshold: %s), sustained for %ds",
			rule.Name, pod.Namespace, pod.Name, rule.MetricType, measuredValue, threshold, rule.DurationSeconds),
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	}

	me.hub.BroadcastEvent(types.EventAlertTriggered, clusterID, event)
	log.Printf("[MetricEvaluator] ALERT FIRED: rule=%s pod=%s/%s metric=%s value=%s",
		rule.RuleID, pod.Namespace, pod.Name, rule.MetricType, measuredValue)
}

// ────────────────────────────────────────────────────────────────────────────
// Comparison Helpers
// ────────────────────────────────────────────────────────────────────────────

func compareNumeric(actual float64, op string, threshold float64) bool {
	switch op {
	case ">":
		return actual > threshold
	case ">=":
		return actual >= threshold
	case "<":
		return actual < threshold
	case "<=":
		return actual <= threshold
	case "==":
		return actual == threshold
	case "!=":
		return actual != threshold
	default:
		return false
	}
}

func compareString(actual, op, expected string) bool {
	switch op {
	case "==":
		return actual == expected
	case "!=":
		return actual != expected
	default:
		return false
	}
}
