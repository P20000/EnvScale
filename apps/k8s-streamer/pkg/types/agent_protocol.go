package types

import "time"

// Agent Protocol v2.0 event names for multiplexed control and log streaming.
const (
	EventAgentHello      = "AGENT_HELLO"
	EventServerHelloAck  = "SERVER_HELLO_ACK"
	EventProtocolError   = "PROTOCOL_ERROR"
	EventLogStreamStart  = "LOG_STREAM_START"
	EventLogStreamStop   = "LOG_STREAM_STOP"
	EventLogFrame        = "LOG_FRAME"
	EventLogDiagnostic   = "LOG_DIAGNOSTIC"
	EventLogStreamStatus = "LOG_STREAM_STATUS"
	EventLogStreamEnd    = "LOG_STREAM_END"
	EventLogStreamError  = "LOG_STREAM_ERROR"
)

// AgentCapabilityReport describes a single capability probed by the in-cluster agent.
type AgentCapabilityReport struct {
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}

// AgentHelloPayload is sent by an Agent Protocol v2.0 client immediately after connecting.
type AgentHelloPayload struct {
	ProtocolVersion string                           `json:"protocolVersion"`
	AgentVersion    string                           `json:"agentVersion,omitempty"`
	Capabilities    map[string]AgentCapabilityReport `json:"capabilities,omitempty"`
}

// ServerHelloAckPayload is returned by the control plane after processing AGENT_HELLO.
type ServerHelloAckPayload struct {
	ClusterID       string `json:"clusterId"`
	SessionID       string `json:"sessionId"`
	ProtocolVersion string `json:"protocolVersion"`
}

// ProtocolErrorPayload is returned when an Agent advertises an unsupported protocol version.
type ProtocolErrorPayload struct {
	Code              string   `json:"code"`
	RequestedVersion  string   `json:"requestedVersion"`
	SupportedVersions []string `json:"supportedVersions"`
	Reason            string   `json:"reason"`
}

// LogStreamStartPayload carries a normalized request from the control plane to the agent.
type LogStreamStartPayload struct {
	StreamID     string     `json:"streamId"`
	ClusterID    string     `json:"clusterId,omitempty"`
	SessionID    string     `json:"sessionId,omitempty"`
	Namespace    string     `json:"namespace"`
	Kind         string     `json:"kind"`
	Name         string     `json:"name"`
	Container    string     `json:"container,omitempty"`
	TailLines    int64      `json:"tailLines"`
	Follow       bool       `json:"follow"`
	Previous     bool       `json:"previous,omitempty"`
	Timestamps   bool       `json:"timestamps"`
	SinceSeconds *int64     `json:"sinceSeconds,omitempty"`
	SinceTime    *time.Time `json:"sinceTime,omitempty"`
}

// LogStreamStopPayload instructs the agent to cancel and tear down an active stream.
type LogStreamStopPayload struct {
	StreamID  string `json:"streamId"`
	ClusterID string `json:"clusterId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// LogStreamFrame is the unified normalized frame shared across Direct, Agent, and WS clients.
type LogStreamFrame struct {
	Type            string `json:"type"` // "log" | "diagnostic" | "status" | "end" | "error" | "cancel"
	StreamID        string `json:"streamId,omitempty"`
	ClusterID       string `json:"clusterId,omitempty"`
	SessionID       string `json:"sessionId,omitempty"`
	Sequence        uint64 `json:"sequence,omitempty"`
	Timestamp       string `json:"timestamp"`
	Namespace       string `json:"namespace,omitempty"`
	Pod             string `json:"pod,omitempty"`
	Container       string `json:"container,omitempty"`
	Source          string `json:"source,omitempty"`
	Stream          string `json:"stream,omitempty"` // "stdout" | "stderr"
	Kind            string `json:"kind,omitempty"`
	Level           string `json:"level,omitempty"`
	Message         string `json:"message,omitempty"`
	Status          string `json:"status,omitempty"`
	Code            string `json:"code,omitempty"`
	Reason          string `json:"reason,omitempty"`
	RetryCount      int    `json:"retryCount,omitempty"`
	NextRetryMs     int64  `json:"nextRetryMs,omitempty"`
	TotalStreams    int    `json:"totalStreams,omitempty"`
	ActiveStreams   int    `json:"activeStreams,omitempty"`
	RetryingStreams int    `json:"retryingStreams,omitempty"`
	FailedStreams   int    `json:"failedStreams,omitempty"`
	Scope           string `json:"scope,omitempty"`
}

