package k8s

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// AnomalyMatch represents a detected anomaly from either a log line or pod status phase.
// Returned by AnalyzeLogLine and ClassifyPodAnomaly; nil means no anomaly detected.
type AnomalyMatch struct {
	AnomalyType string
	Severity    types.AnomalySeverity
	Message     string
}

// logAnomalyPattern defines a single compiled regex rule mapped to an anomaly classification.
type logAnomalyPattern struct {
	pattern     *regexp.Regexp
	anomalyType string
	severity    types.AnomalySeverity
	message     string
}

// Compiled anomaly detection patterns — initialized once at package load time.
// Each pattern is designed to match the most common Kubernetes failure signatures
// that appear in pod stdout/stderr log output.
//
// CRITICAL patterns: immediate pod-killing or unrecoverable failures
// WARNING patterns:  degraded states that may self-recover but require attention
var logPatterns = []logAnomalyPattern{
	// ── CRITICAL: Out-of-Memory Kill ──
	{
		pattern:     regexp.MustCompile(`(?i)(OOMKilled|Out of memory[:\s]|oom-kill|Kill process \d+ .* score|invoked oom-killer)`),
		anomalyType: "OOMKilled",
		severity:    types.SeverityCritical,
		message:     "Container killed due to out-of-memory condition — increase memory limits or investigate memory leak",
	},
	// ── CRITICAL: Go/Runtime Panic ──
	{
		pattern:     regexp.MustCompile(`(?m)^.*(?:panic:|runtime error:|goroutine \d+ \[)`),
		anomalyType: "PanicDetected",
		severity:    types.SeverityCritical,
		message:     "Runtime panic or unrecovered error detected in application logs",
	},
	// ── CRITICAL: Fatal Error ──
	{
		pattern:     regexp.MustCompile(`(?i)(fatal error[:\s]|FATAL[:\s]|fatal exception)`),
		anomalyType: "FatalError",
		severity:    types.SeverityCritical,
		message:     "Fatal error detected — process is likely crashing",
	},
	// ── WARNING: Image Pull Failures ──
	{
		pattern:     regexp.MustCompile(`(?i)(ImagePullBackOff|ErrImagePull|Failed to pull image|repository does not exist|manifest unknown|unauthorized: authentication required)`),
		anomalyType: "ImagePullBackOff",
		severity:    types.SeverityWarning,
		message:     "Container image could not be pulled — check image name, tag, and registry credentials",
	},
	// ── WARNING: CrashLoopBackOff ──
	{
		pattern:     regexp.MustCompile(`(?i)(CrashLoopBackOff|back-off restarting failed container)`),
		anomalyType: "CrashLoopBackOff",
		severity:    types.SeverityWarning,
		message:     "Container is crash-looping — investigate application startup errors",
	},
	// ── WARNING: Health Probe Failures ──
	{
		pattern:     regexp.MustCompile(`(?i)(Readiness probe failed|Liveness probe failed|Startup probe failed|probe errored)`),
		anomalyType: "ProbeFailure",
		severity:    types.SeverityWarning,
		message:     "Health probe failure detected — pod may be removed from service endpoints",
	},
	// ── WARNING: Container Start Failures ──
	{
		pattern:     regexp.MustCompile(`(?i)(exec format error|permission denied.*exec|CreateContainerConfigError|RunContainerError|standard_init_linux\.go)`),
		anomalyType: "ContainerStartFailure",
		severity:    types.SeverityWarning,
		message:     "Container failed to start — check entrypoint, permissions, and image architecture",
	},
}

// knownAnomalyPhases maps Kubernetes container status reason strings (reported by
// the kubelet via ContainerStatuses[].State.Waiting.Reason and
// LastTerminationState.Terminated.Reason) to their anomaly classification.
// These are the exact strings that extractPodDelta() in informer.go propagates
// as the pod's "phase" field.
var knownAnomalyPhases = map[string]AnomalyMatch{
	"OOMKilled": {
		AnomalyType: "OOMKilled",
		Severity:    types.SeverityCritical,
		Message:     "Pod terminated due to OOMKilled — container exceeded its memory limit",
	},
	"CrashLoopBackOff": {
		AnomalyType: "CrashLoopBackOff",
		Severity:    types.SeverityWarning,
		Message:     "Pod is in CrashLoopBackOff — container is repeatedly crashing after startup",
	},
	"ImagePullBackOff": {
		AnomalyType: "ImagePullBackOff",
		Severity:    types.SeverityWarning,
		Message:     "Pod stuck in ImagePullBackOff — unable to pull the container image",
	},
	"ErrImagePull": {
		AnomalyType: "ImagePullBackOff",
		Severity:    types.SeverityWarning,
		Message:     "Image pull error — check image name, tag, and registry authentication",
	},
	"CreateContainerConfigError": {
		AnomalyType: "ContainerStartFailure",
		Severity:    types.SeverityWarning,
		Message:     "Container configuration error — check ConfigMaps, Secrets, and volume mounts",
	},
	"RunContainerError": {
		AnomalyType: "ContainerStartFailure",
		Severity:    types.SeverityCritical,
		Message:     "Container runtime error — failed to start the container process",
	},
	"InvalidImageName": {
		AnomalyType: "ImagePullBackOff",
		Severity:    types.SeverityWarning,
		Message:     "Invalid container image name — check the image reference in the pod spec",
	},
}

// highRestartThreshold is the restart count above which a HighRestartCount
// warning anomaly is emitted, even if the current phase looks healthy.
const highRestartThreshold int32 = 5

// AnalyzeLogLine inspects a single log line from the live pod log stream for
// known anomaly patterns. Returns an AnomalyMatch if a pattern is detected,
// or nil for normal log lines. This function is called on the hot path inside
// the doStream scanner loop, so it must be fast — all regex patterns are
// pre-compiled at package init time.
func AnalyzeLogLine(line string) *AnomalyMatch {
	for i := range logPatterns {
		if logPatterns[i].pattern.MatchString(line) {
			return &AnomalyMatch{
				AnomalyType: logPatterns[i].anomalyType,
				Severity:    logPatterns[i].severity,
				Message:     logPatterns[i].message,
			}
		}
	}
	return nil
}

// ClassifyPodAnomaly inspects a pod's current phase string and restart count
// (as reported by the Kubernetes Informer pipeline) and returns an AnomalyMatch
// if the phase represents a known failure state or if the restart count exceeds
// the high-restart threshold.
//
// The phase parameter comes from extractPodDelta() in informer.go which resolves
// it from ContainerStatuses[].State.Waiting.Reason or
// LastTerminationState.Terminated.Reason — not the raw pod.Status.Phase.
func ClassifyPodAnomaly(phase string, restartCount int32) *AnomalyMatch {
	// Direct phase lookup — O(1) map access
	if match, ok := knownAnomalyPhases[phase]; ok {
		return &match
	}

	// Case-insensitive fallback for phases that may arrive in different casing
	phaseLower := strings.ToLower(phase)
	for key, match := range knownAnomalyPhases {
		if strings.ToLower(key) == phaseLower {
			return &match
		}
	}

	// High restart count detection — fires even when the current phase is "Running"
	if restartCount >= highRestartThreshold {
		return &AnomalyMatch{
			AnomalyType: "HighRestartCount",
			Severity:    types.SeverityWarning,
			Message:     fmt.Sprintf("Pod has restarted %d times (threshold: %d) — investigate stability", restartCount, highRestartThreshold),
		}
	}

	return nil
}
