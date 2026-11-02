package server

type StreamLogMessage struct {
	Type      string `json:"type"` // "log"
	Timestamp string `json:"timestamp"`
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Source    string `json:"source"` // "namespace/pod/container"
	Level     string `json:"level"`
	Message   string `json:"message"`
	Stream    string `json:"stream"` // "stdout" | "stderr"
	Kind      string `json:"kind"`
}

type StreamDiagnosticMessage struct {
	Type        string `json:"type"` // "diagnostic"
	Timestamp   string `json:"timestamp"`
	Source      string `json:"source"`
	Namespace   string `json:"namespace,omitempty"`
	Pod         string `json:"pod,omitempty"`
	Container   string `json:"container,omitempty"`
	Status      string `json:"status"` // "active" | "retrying" | "backoff" | "failed" | "terminated" | "permission_denied"
	Reason      string `json:"reason"`
	RetryCount  int    `json:"retryCount,omitempty"`
	NextRetryMs int64  `json:"nextRetryMs,omitempty"`
}

type StreamStatusMessage struct {
	Type            string `json:"type"` // "status"
	Timestamp       string `json:"timestamp"`
	TotalStreams    int    `json:"totalStreams"`
	ActiveStreams   int    `json:"activeStreams"`
	RetryingStreams int    `json:"retryingStreams"`
	FailedStreams   int    `json:"failedStreams"`
	Scope           string `json:"scope"`
}
