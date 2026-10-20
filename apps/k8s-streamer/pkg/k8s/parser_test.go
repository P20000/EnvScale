package k8s

import (
	"fmt"
	"strings"
	"testing"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// ─────────────────────────────────────────────────────────
// Table-driven tests for AnalyzeLogLine
// ─────────────────────────────────────────────────────────

func TestAnalyzeLogLine_DetectsAnomalies(t *testing.T) {
	tests := []struct {
		name            string
		line            string
		wantAnomalyType string
		wantSeverity    types.AnomalySeverity
	}{
		// ── OOMKilled patterns ──
		{
			name:            "OOMKilled keyword",
			line:            "2024-08-20T10:00:00Z Container killed: OOMKilled",
			wantAnomalyType: "OOMKilled",
			wantSeverity:    types.SeverityCritical,
		},
		{
			name:            "kernel OOM killer invocation",
			line:            "Out of memory: Kill process 12345 (java) score 950 or sacrifice child",
			wantAnomalyType: "OOMKilled",
			wantSeverity:    types.SeverityCritical,
		},
		{
			name:            "oom-kill dmesg style",
			line:            "oom-kill:constraint=CONSTRAINT_MEMCG,nodemask=(null)",
			wantAnomalyType: "OOMKilled",
			wantSeverity:    types.SeverityCritical,
		},

		// ── Panic patterns ──
		{
			name:            "Go panic",
			line:            "panic: runtime error: index out of range [3] with length 2",
			wantAnomalyType: "PanicDetected",
			wantSeverity:    types.SeverityCritical,
		},
		{
			name:            "goroutine stack trace header",
			line:            "goroutine 1 [running]:",
			wantAnomalyType: "PanicDetected",
			wantSeverity:    types.SeverityCritical,
		},
		{
			name:            "runtime error standalone",
			line:            "runtime error: invalid memory address or nil pointer dereference",
			wantAnomalyType: "PanicDetected",
			wantSeverity:    types.SeverityCritical,
		},

		// ── Fatal error patterns ──
		{
			name:            "fatal error with colon",
			line:            "fatal error: concurrent map writes",
			wantAnomalyType: "FatalError",
			wantSeverity:    types.SeverityCritical,
		},
		{
			name:            "FATAL log level",
			line:            "FATAL: database connection refused on localhost:5432",
			wantAnomalyType: "FatalError",
			wantSeverity:    types.SeverityCritical,
		},

		// ── ImagePullBackOff patterns ──
		{
			name:            "ImagePullBackOff keyword",
			line:            "Warning ImagePullBackOff: pulling image 'myrepo/myapp:v2.3'",
			wantAnomalyType: "ImagePullBackOff",
			wantSeverity:    types.SeverityWarning,
		},
		{
			name:            "ErrImagePull",
			line:            "ErrImagePull: rpc error: code = Unknown desc = Error response from daemon",
			wantAnomalyType: "ImagePullBackOff",
			wantSeverity:    types.SeverityWarning,
		},
		{
			name:            "Failed to pull image",
			line:            "Failed to pull image 'nginx:nonexistent': manifest unknown",
			wantAnomalyType: "ImagePullBackOff",
			wantSeverity:    types.SeverityWarning,
		},
		{
			name:            "unauthorized registry",
			line:            "unauthorized: authentication required for private.registry.io",
			wantAnomalyType: "ImagePullBackOff",
			wantSeverity:    types.SeverityWarning,
		},

		// ── CrashLoopBackOff patterns ──
		{
			name:            "CrashLoopBackOff keyword",
			line:            "Warning: CrashLoopBackOff — container failed to start",
			wantAnomalyType: "CrashLoopBackOff",
			wantSeverity:    types.SeverityWarning,
		},
		{
			name:            "back-off restarting",
			line:            "Back-off restarting failed container app in pod myapp-7d9b5-xz2k1",
			wantAnomalyType: "CrashLoopBackOff",
			wantSeverity:    types.SeverityWarning,
		},

		// ── Probe failure patterns ──
		{
			name:            "Readiness probe failed",
			line:            "Readiness probe failed: HTTP probe failed with statuscode: 503",
			wantAnomalyType: "ProbeFailure",
			wantSeverity:    types.SeverityWarning,
		},
		{
			name:            "Liveness probe failed",
			line:            "Liveness probe failed: connection refused",
			wantAnomalyType: "ProbeFailure",
			wantSeverity:    types.SeverityWarning,
		},

		// ── Container start failure patterns ──
		{
			name:            "exec format error",
			line:            "exec format error: binary is compiled for amd64 but running on arm64",
			wantAnomalyType: "ContainerStartFailure",
			wantSeverity:    types.SeverityWarning,
		},
		{
			name:            "CreateContainerConfigError",
			line:            "Warning: CreateContainerConfigError: secret 'db-credentials' not found",
			wantAnomalyType: "ContainerStartFailure",
			wantSeverity:    types.SeverityWarning,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			match := AnalyzeLogLine(tt.line)
			if match == nil {
				t.Fatalf("expected anomaly match for line %q, got nil", tt.line)
			}
			if match.AnomalyType != tt.wantAnomalyType {
				t.Errorf("anomaly type = %q, want %q", match.AnomalyType, tt.wantAnomalyType)
			}
			if match.Severity != tt.wantSeverity {
				t.Errorf("severity = %q, want %q", match.Severity, tt.wantSeverity)
			}
			if match.Message == "" {
				t.Error("message should not be empty")
			}
		})
	}
}

func TestAnalyzeLogLine_NoFalsePositives(t *testing.T) {
	normalLines := []string{
		"2024-08-20T10:00:00Z INFO  Server started on port 8080",
		"2024-08-20T10:00:01Z DEBUG Processing request /api/v1/pods",
		"2024-08-20T10:00:02Z WARN  Slow query detected: 250ms",
		"Successfully pulled image 'nginx:1.25'",
		"Container started successfully",
		"Health check passed — all probes healthy",
		"Connection established to postgres:5432",
		"GET /healthz 200 OK (2ms)",
		"memory usage: 256Mi / 512Mi (50%)",
		"Restarting worker pool with 4 goroutines",
		"",
	}

	for _, line := range normalLines {
		match := AnalyzeLogLine(line)
		if match != nil {
			t.Errorf("unexpected anomaly match for normal line %q: got %+v", line, match)
		}
	}
}

// ─────────────────────────────────────────────────────────
// Table-driven tests for ClassifyPodAnomaly
// ─────────────────────────────────────────────────────────

func TestClassifyPodAnomaly_KnownPhases(t *testing.T) {
	tests := []struct {
		phase           string
		restartCount    int32
		wantAnomalyType string
		wantSeverity    types.AnomalySeverity
	}{
		{"OOMKilled", 0, "OOMKilled", types.SeverityCritical},
		{"CrashLoopBackOff", 3, "CrashLoopBackOff", types.SeverityWarning},
		{"ImagePullBackOff", 0, "ImagePullBackOff", types.SeverityWarning},
		{"ErrImagePull", 0, "ImagePullBackOff", types.SeverityWarning},
		{"CreateContainerConfigError", 0, "ContainerStartFailure", types.SeverityWarning},
		{"RunContainerError", 0, "ContainerStartFailure", types.SeverityCritical},
		{"InvalidImageName", 0, "ImagePullBackOff", types.SeverityWarning},
	}

	for _, tt := range tests {
		t.Run(tt.phase, func(t *testing.T) {
			match := ClassifyPodAnomaly(tt.phase, tt.restartCount)
			if match == nil {
				t.Fatalf("expected anomaly match for phase %q, got nil", tt.phase)
			}
			if match.AnomalyType != tt.wantAnomalyType {
				t.Errorf("anomaly type = %q, want %q", match.AnomalyType, tt.wantAnomalyType)
			}
			if match.Severity != tt.wantSeverity {
				t.Errorf("severity = %q, want %q", match.Severity, tt.wantSeverity)
			}
		})
	}
}

func TestClassifyPodAnomaly_HighRestartCount(t *testing.T) {
	// Running phase with high restarts should trigger HighRestartCount
	match := ClassifyPodAnomaly("Running", 5)
	if match == nil {
		t.Fatal("expected HighRestartCount anomaly for 5 restarts, got nil")
	}
	if match.AnomalyType != "HighRestartCount" {
		t.Errorf("anomaly type = %q, want %q", match.AnomalyType, "HighRestartCount")
	}
	if match.Severity != types.SeverityWarning {
		t.Errorf("severity = %q, want %q", match.Severity, types.SeverityWarning)
	}
	if !strings.Contains(match.Message, "5") {
		t.Errorf("message should contain restart count, got: %s", match.Message)
	}

	// Below threshold — should NOT trigger
	match = ClassifyPodAnomaly("Running", 4)
	if match != nil {
		t.Errorf("unexpected anomaly for 4 restarts (below threshold): %+v", match)
	}
}

func TestClassifyPodAnomaly_HealthyPhases(t *testing.T) {
	healthyPhases := []string{"Running", "Succeeded", "Pending", "ContainerCreating"}

	for _, phase := range healthyPhases {
		match := ClassifyPodAnomaly(phase, 0)
		if match != nil {
			t.Errorf("unexpected anomaly for healthy phase %q: %+v", phase, match)
		}
	}
}

func TestClassifyPodAnomaly_CaseInsensitive(t *testing.T) {
	// Phase reported in different casing should still match
	variants := []string{"oomkilled", "OOMKILLED", "OomKilled", "oomKILLED"}
	for _, phase := range variants {
		t.Run(phase, func(t *testing.T) {
			match := ClassifyPodAnomaly(phase, 0)
			if match == nil {
				t.Fatalf("expected match for case variant %q, got nil", phase)
			}
			if match.AnomalyType != "OOMKilled" {
				t.Errorf("anomaly type = %q, want OOMKilled", match.AnomalyType)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────
// Benchmark: AnalyzeLogLine hot path performance
// ─────────────────────────────────────────────────────────

func BenchmarkAnalyzeLogLine_NormalLine(b *testing.B) {
	// Normal log lines are the 99% hot path — they must be fast
	line := "2024-08-20T10:00:00Z INFO  Processing batch job #12345 with 256 items"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		AnalyzeLogLine(line)
	}
}

func BenchmarkAnalyzeLogLine_AnomalyLine(b *testing.B) {
	line := "panic: runtime error: index out of range [42] with length 10"
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		AnalyzeLogLine(line)
	}
}

func BenchmarkAnalyzeLogLine_LongLine(b *testing.B) {
	// Simulate a long stack trace or verbose JSON log line
	line := fmt.Sprintf("2024-08-20T10:00:00Z ERROR %s", strings.Repeat("a]", 5000))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		AnalyzeLogLine(line)
	}
}
