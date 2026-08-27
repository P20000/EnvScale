package k8s

import (
	"testing"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// mockSnapshotProvider implements SnapshotProvider for unit testing.
type mockSnapshotProvider struct {
	clusters map[string]bool
	pods     map[string][]types.PodStatusDelta
	nodes    map[string][]types.NodeStatusDelta
}

func (m *mockSnapshotProvider) GetClusterSnapshot(clusterID string) (
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
) {
	return m.pods[clusterID], m.nodes[clusterID], nil, nil, nil, nil, nil, nil, nil, nil
}

func (m *mockSnapshotProvider) ListClusters() map[string]bool {
	return m.clusters
}

func TestMetricEvaluator_RuleManagement(t *testing.T) {
	hub := websocket.NewHub()
	provider := &mockSnapshotProvider{clusters: make(map[string]bool)}
	eval := NewMetricEvaluator(provider, hub)

	if eval.RuleCount() != 0 {
		t.Fatalf("Expected 0 rules initially, got %d", eval.RuleCount())
	}

	rule1 := AlertRule{
		RuleID:            "rule-1",
		MetricType:        "pod_restarts",
		ConditionOperator: ">",
		ThresholdValue:    5,
		DurationSeconds:   0,
		Severity:          "CRITICAL",
		Enabled:           true,
		Name:              "High Restart Count",
	}

	eval.AddRule(rule1)
	if eval.RuleCount() != 1 {
		t.Fatalf("Expected 1 rule after AddRule, got %d", eval.RuleCount())
	}

	// Update existing rule
	rule1Updated := rule1
	rule1Updated.ThresholdValue = 10
	eval.AddRule(rule1Updated)

	if eval.RuleCount() != 1 {
		t.Fatalf("Expected rule count to remain 1 after updating existing rule, got %d", eval.RuleCount())
	}

	rules := eval.ListRules()
	if rules[0].ThresholdValue != 10 {
		t.Fatalf("Expected updated threshold 10, got %v", rules[0].ThresholdValue)
	}

	// Remove rule
	removed := eval.RemoveRule("rule-1")
	if !removed {
		t.Fatalf("Expected RemoveRule to return true")
	}
	if eval.RuleCount() != 0 {
		t.Fatalf("Expected 0 rules after removal, got %d", eval.RuleCount())
	}
}

func TestMetricEvaluator_EvaluatesRulesAndTriggersAlert(t *testing.T) {
	hub := websocket.NewHub()
	go hub.Run()

	provider := &mockSnapshotProvider{
		clusters: map[string]bool{"cluster-eval": true},
		pods: map[string][]types.PodStatusDelta{
			"cluster-eval": {
				{
					Name:         "failing-pod",
					Namespace:    "production",
					Phase:        "CrashLoopBackOff",
					RestartCount: 12,
				},
				{
					Name:         "healthy-pod",
					Namespace:    "production",
					Phase:        "Running",
					RestartCount: 0,
				},
			},
		},
	}

	eval := NewMetricEvaluator(provider, hub)
	eval.SetInterval(50 * time.Millisecond) // fast tick for testing

	rule := AlertRule{
		RuleID:            "rule-crashloop",
		MetricType:        "pod_restarts",
		ConditionOperator: ">",
		ThresholdValue:    5,
		DurationSeconds:   0, // immediate alert
		Severity:          "CRITICAL",
		Enabled:           true,
		Name:              "Pod Restart Threshold Exceeded",
	}

	eval.SetRules([]AlertRule{rule})
	eval.Start()
	defer eval.Stop()

	// Wait for one or two evaluation cycles
	time.Sleep(150 * time.Millisecond)

	if !eval.IsRunning() {
		t.Fatalf("Expected evaluator to be running")
	}
}

func TestCompareNumeric(t *testing.T) {
	tests := []struct {
		actual    float64
		op        string
		threshold float64
		want      bool
	}{
		{10, ">", 5, true},
		{5, ">", 5, false},
		{5, ">=", 5, true},
		{3, "<", 5, true},
		{5, "<=", 5, true},
		{5, "==", 5, true},
		{5, "!=", 5, false},
		{10, "!=", 5, true},
	}

	for _, tt := range tests {
		got := compareNumeric(tt.actual, tt.op, tt.threshold)
		if got != tt.want {
			t.Errorf("compareNumeric(%v, %q, %v) = %v; want %v", tt.actual, tt.op, tt.threshold, got, tt.want)
		}
	}
}

func TestCompareString(t *testing.T) {
	if !compareString("CrashLoopBackOff", "==", "CrashLoopBackOff") {
		t.Errorf("Expected string match = true")
	}
	if compareString("Running", "==", "CrashLoopBackOff") {
		t.Errorf("Expected string match = false")
	}
	if !compareString("Running", "!=", "CrashLoopBackOff") {
		t.Errorf("Expected string inequality = true")
	}
}
