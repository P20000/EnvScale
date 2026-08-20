package types

import "time"

// Event Type Constants matching shared monorepo contracts
const (
	EventPodStatusChanged    = "EVENT_POD_STATUS_CHANGED"
	EventNodeMutated         = "EVENT_NODE_MUTATED"
	EventServiceMutated      = "EVENT_SERVICE_MUTATED"
	EventLogLine             = "EVENT_LOG_LINE"
	EventAlertTriggered      = "EVENT_ALERT_TRIGGERED"
	EventHeartbeat           = "EVENT_HEARTBEAT"
	EventPodAnomalyDetected  = "EVENT_POD_ANOMALY_DETECTED"
	EventDeploymentMutated   = "EVENT_DEPLOYMENT_MUTATED"
	EventReplicaSetMutated   = "EVENT_REPLICA_SET_MUTATED"
	EventStatefulSetMutated  = "EVENT_STATEFUL_SET_MUTATED"
	EventIngressMutated      = "EVENT_INGRESS_MUTATED"
)

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
	Phase          string            `json:"phase"`
	RestartCount   int32             `json:"restartCount"`
	CPUUsagePct    float64           `json:"cpuUsagePct,omitempty"`
	MemoryUsageMb  float64           `json:"memoryUsageMb,omitempty"`
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

// IngressStatusDelta encapsulates K8s Ingress state updates
type IngressStatusDelta struct {
	Name      string              `json:"name"`
	Namespace string              `json:"namespace"`
	Rules     []IngressRuleStatus `json:"rules"`
	Labels    map[string]string   `json:"labels"`
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
