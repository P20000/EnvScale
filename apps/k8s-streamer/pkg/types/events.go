package types

import "time"

// Event Type Constants matching shared monorepo contracts
const (
	EventPodStatusChanged   = "EVENT_POD_STATUS_CHANGED"
	EventPodDeleted         = "EVENT_POD_DELETED"
	EventNodeMutated        = "EVENT_NODE_MUTATED"
	EventServiceMutated     = "EVENT_SERVICE_MUTATED"
	EventLogLine            = "EVENT_LOG_LINE"
	EventAlertTriggered     = "EVENT_ALERT_TRIGGERED"
	EventHeartbeat          = "EVENT_HEARTBEAT"
	EventPodAnomalyDetected = "EVENT_POD_ANOMALY_DETECTED"
	EventDeploymentMutated  = "EVENT_DEPLOYMENT_MUTATED"
	EventReplicaSetMutated  = "EVENT_REPLICA_SET_MUTATED"
	EventStatefulSetMutated = "EVENT_STATEFUL_SET_MUTATED"
	EventIngressMutated     = "EVENT_INGRESS_MUTATED"

	// Chaos fault injection events — emitted by the chaos engine when a fault is
	// injected into or cleared from a target workload.
	EventChaosFaultInjected = "EVENT_CHAOS_FAULT_INJECTED"
	EventChaosFaultCleared  = "EVENT_CHAOS_FAULT_CLEARED"

	EventK8sIncidentCreated = "EVENT_K8S_INCIDENT_CREATED"
)

// K8sIncidentEvent encapsulates authentic Kubernetes v1.Event telemetry
type K8sIncidentEvent struct {
	EventID      string    `json:"eventId"`
	Reason       string    `json:"reason"`
	Message      string    `json:"message"`
	TargetPod    string    `json:"targetPod"`
	Namespace    string    `json:"namespace"`
	Cluster      string    `json:"cluster"`
	SeverityType string    `json:"severityType"`
	Timestamp    time.Time `json:"timestamp"`
}

// WSEventEnvelope represents the standardized WebSocket JSON frame delivered to client subscribers
type WSEventEnvelope struct {
	Event     string      `json:"event"`
	ClusterID string      `json:"clusterId"`
	Timestamp string      `json:"timestamp"`
	Data      interface{} `json:"data"`
}

// PodStatusDelta encapsulates real-time Kubernetes Pod state changes sent to the UI
type PodStatusDelta struct {
	Name           string            `json:"name"`
	Namespace      string            `json:"namespace"`
	NodeName       string            `json:"nodeName"`
	PodIP          string            `json:"podIp"`
	Phase          string            `json:"phase"`
	RestartCount   int32             `json:"restartCount"`
	CpuUsageMcores int64             `json:"cpuUsageMcores"`
	MemoryUsageMiB int64             `json:"memoryUsageMiB"`
	CPUUsagePct    float64           `json:"cpuUsagePct"`
	MemoryUsageMb  float64           `json:"memoryUsageMb"`
	Labels         map[string]string `json:"labels"`
	OwnerUID       string            `json:"ownerUid,omitempty"`
	OwnerName      string            `json:"ownerName,omitempty"`
	OwnerKind      string            `json:"ownerKind,omitempty"`
	CreatedAt      time.Time         `json:"createdAt"`
}

// DeploymentStatusDelta encapsulates Deployment state updates
type DeploymentStatusDelta struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Replicas      int32             `json:"replicas"`
	ReadyReplicas int32             `json:"readyReplicas"`
	Selector      map[string]string `json:"selector"`
	Labels        map[string]string `json:"labels"`
}

// ReplicaSetStatusDelta encapsulates ReplicaSet state updates
type ReplicaSetStatusDelta struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Replicas      int32             `json:"replicas"`
	ReadyReplicas int32             `json:"readyReplicas"`
	OwnerUID      string            `json:"ownerUid,omitempty"`
	OwnerName     string            `json:"ownerName,omitempty"`
	OwnerKind     string            `json:"ownerKind,omitempty"`
	Labels        map[string]string `json:"labels"`
}

// StatefulSetStatusDelta encapsulates StatefulSet state updates
type StatefulSetStatusDelta struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Replicas      int32             `json:"replicas"`
	ReadyReplicas int32             `json:"readyReplicas"`
	Selector      map[string]string `json:"selector"`
	Labels        map[string]string `json:"labels"`
}

// NodeStatusDelta encapsulates node health state updates
type NodeStatusDelta struct {
	Name           string            `json:"name"`
	Status         string            `json:"status"` // "Ready", "NotReady", "Unknown"
	CPUCapacity    string            `json:"cpuCapacity"`
	MemoryCapacity string            `json:"memoryCapacity"`
	PodCapacity    int64             `json:"podCapacity"`
	Labels         map[string]string `json:"labels"`
}

// ServiceStatusDelta encapsulates K8s Service state updates
type ServiceStatusDelta struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Type        string            `json:"type"`
	ClusterIP   string            `json:"clusterIP"`
	Selector    map[string]string `json:"selector"`
	TargetPorts []int32           `json:"targetPorts"`
}

// IngressRuleStatus represents a single routing rule path in an Ingress
type IngressRuleStatus struct {
	Host        string `json:"host"`
	Path        string `json:"path"`
	ServiceName string `json:"serviceName"`
	ServicePort int32  `json:"servicePort"`
}

// IngressTLSStatus represents TLS secret and host bindings
type IngressTLSStatus struct {
	Hosts      []string `json:"hosts"`
	SecretName string   `json:"secretName"`
}

// IngressStatusDelta encapsulates K8s Ingress state updates
type IngressStatusDelta struct {
	Name             string              `json:"name"`
	Namespace        string              `json:"namespace"`
	IngressClassName string              `json:"ingressClassName,omitempty"`
	Rules            []IngressRuleStatus `json:"rules"`
	TLS              []IngressTLSStatus  `json:"tls,omitempty"`
	LoadBalancerIPs  []string            `json:"loadBalancerIps,omitempty"`
	Labels           map[string]string   `json:"labels"`
}

// LogStreamEvent encapsulates live stdout/stderr log lines
type LogStreamEvent struct {
	PodName   string `json:"podName"`
	Namespace string `json:"namespace"`
	Container string `json:"container"`
	Log       string `json:"log"`
	Stream    string `json:"stream"` // "stdout" | "stderr"
	Timestamp string `json:"timestamp"`
}

// AnomalySeverity classifies the urgency of a detected pod anomaly
type AnomalySeverity string

const (
	SeverityCritical AnomalySeverity = "CRITICAL"
	SeverityWarning  AnomalySeverity = "WARNING"
)

// PodAnomalyEvent encapsulates a real-time anomaly detection alert emitted
// when the parser identifies a known failure pattern from either the Informer
// pipeline (pod status phase) or the live log stream (regex-matched text).
type PodAnomalyEvent struct {
	PodName     string          `json:"podName"`
	Namespace   string          `json:"namespace"`
	Container   string          `json:"container,omitempty"`
	AnomalyType string          `json:"anomalyType"` // "OOMKilled", "CrashLoopBackOff", "ImagePullBackOff", "PanicDetected", etc.
	Severity    AnomalySeverity `json:"severity"`
	Message     string          `json:"message"`              // Human-readable anomaly description
	LogSnippet  string          `json:"logSnippet,omitempty"` // Triggering log line (for log-source detections only)
	Source      string          `json:"source"`               // "informer" | "log_stream"
	Timestamp   string          `json:"timestamp"`
}

// ChaosFaultEvent is broadcast over WebSocket when the chaos engine injects or
// clears a fault on a Kubernetes workload. The frontend topology canvas uses this
// to visually highlight affected pods/deployments with a "chaos" badge overlay.
type ChaosFaultEvent struct {
	FaultID    string `json:"faultId"`    // Unique ID for this fault injection (used to track/cancel)
	FaultType  string `json:"faultType"`  // "crash", "oom-pressure", "scale-down"
	Target     string `json:"target"`     // "pod" | "deployment"
	Name       string `json:"name"`       // Pod or Deployment name
	Namespace  string `json:"namespace"`
	ClusterID  string `json:"clusterId"`
	Status     string `json:"status"`     // "injected" | "cleared" | "failed"
	Message    string `json:"message"`    // Human-readable description
	Timestamp  string `json:"timestamp"`
}

// AlertTriggeredEvent is broadcast when the background Metric Evaluator detects
// a pod or node metric violation that has been sustained beyond the rule's
// configured duration threshold. The frontend alert panel uses this to surface
// real-time alerts and optionally record incidents via the api-server.
type AlertTriggeredEvent struct {
	RuleID     string `json:"ruleId"`     // Alert policy ID from api-server
	RuleName   string `json:"ruleName"`   // Human-readable rule name
	Severity   string `json:"severity"`   // "CRITICAL" | "WARNING"
	MetricType string `json:"metricType"` // "pod_restarts" | "pod_phase" | "cpu_usage" | "memory_usage" | "node_status"
	TargetKind string `json:"targetKind"` // "Pod" | "Node"
	TargetName string `json:"targetName"` // Pod or Node name
	Namespace  string `json:"namespace"`
	Measured   string `json:"measured"`   // The actual measured value
	Threshold  string `json:"threshold"`  // The threshold expression (e.g., "> 5")
	Message    string `json:"message"`    // Full human-readable alert description
	Timestamp  string `json:"timestamp"`
}
