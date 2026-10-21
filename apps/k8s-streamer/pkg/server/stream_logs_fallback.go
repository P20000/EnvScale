package server

import (
	"context"
	"fmt"
	"math/rand"
	"time"
)

var sampleEndpoints = []struct {
	path     string
	method   string
	status   int
	duration string
	level    string
}{
	{"/healthz", "GET", 200, "1.1ms", "INFO"},
	{"/api/v1/status", "GET", 200, "3.4ms", "INFO"},
	{"/metrics", "GET", 200, "2.2ms", "DEBUG"},
	{"/api/v1/query", "POST", 200, "21.8ms", "INFO"},
	{"/api/v1/sync", "POST", 200, "15.3ms", "INFO"},
	{"/api/v1/cache/refresh", "POST", 304, "0.9ms", "DEBUG"},
	{"/api/v1/tasks", "GET", 200, "8.7ms", "INFO"},
	{"/internal/heartbeat", "GET", 200, "0.5ms", "TRACE"},
}

// streamFallbackTelemetry streams synthetic telemetry logs for local development testing
// when a target pod is not found in the live cluster or when running offline.
func streamFallbackTelemetry(
	ctx context.Context,
	namespace, name, kind string,
	logChan chan<- StreamLogMessage,
) {
	if kind == "" {
		kind = "Pod"
	}
	source := fmt.Sprintf("%s/main", name)

	initialLogs := []struct {
		offset time.Duration
		level  string
		msg    string
	}{
		{25 * time.Second, "INFO", fmt.Sprintf("Starting container runtime for %s/%s in namespace %s", kind, name, namespace)},
		{22 * time.Second, "INFO", "Mounted volume /var/run/secrets/kubernetes.io/serviceaccount"},
		{18 * time.Second, "INFO", "Loaded configuration profile: activeProfiles=[local,development]"},
		{14 * time.Second, "DEBUG", "TCP connection pool established (min=2, max=20, timeout=5000ms)"},
		{10 * time.Second, "INFO", "HTTP server listening on 0.0.0.0:8080 (ready for ingress traffic)"},
		{6 * time.Second, "INFO", "10.244.0.1 - - \"GET /healthz HTTP/1.1\" 200 48 \"kube-probe/1.35\""},
		{2 * time.Second, "INFO", "10.244.0.1 - - \"GET /api/v1/status HTTP/1.1\" 200 128 \"-\" \"Mozilla/5.0\""},
	}

	now := time.Now()
	for _, l := range initialLogs {
		select {
		case logChan <- StreamLogMessage{
			Timestamp: now.Add(-l.offset).UTC().Format(time.RFC3339),
			Source:    source,
			Level:     l.level,
			Message:   l.msg,
			Kind:      kind,
		}:
		case <-ctx.Done():
			return
		}
	}

	ticker := time.NewTicker(1500 * time.Millisecond)
	defer ticker.Stop()

	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	for {
		select {
		case <-ctx.Done():
			return
		case t := <-ticker.C:
			sample := sampleEndpoints[r.Intn(len(sampleEndpoints))]
			isErr := r.Float64() < 0.05
			level := sample.level
			status := sample.status
			msg := fmt.Sprintf("10.244.0.1 - - \"%s %s HTTP/1.1\" %d 96 \"-\" \"EnvScale-Client/1.0\" (%s)", sample.method, sample.path, status, sample.duration)
			if isErr {
				level = "WARN"
				msg = fmt.Sprintf("Client connection closed before response finalized for %s (%s)", sample.path, sample.duration)
			}

			select {
			case logChan <- StreamLogMessage{
				Timestamp: t.UTC().Format(time.RFC3339),
				Source:    source,
				Level:     level,
				Message:   msg,
				Kind:      kind,
			}:
			case <-ctx.Done():
				return
			}
		}
	}
}
