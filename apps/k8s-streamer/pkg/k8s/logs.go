package k8s

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// LogStreamKey uniquely identifies an active log stream session.
type LogStreamKey struct {
	ClusterID string
	Namespace string
	PodName   string
	Container string
}

// PodLogStreamer manages live kubectl-logs-f style log streaming sessions
// for multiple pods across multiple workspace clusters simultaneously.
type PodLogStreamer struct {
	hub      *websocket.Hub
	sessions map[LogStreamKey]context.CancelFunc
	mu       sync.Mutex
}

// NewPodLogStreamer creates a new PodLogStreamer attached to the given Hub
func NewPodLogStreamer(hub *websocket.Hub) *PodLogStreamer {
	return &PodLogStreamer{
		hub:      hub,
		sessions: make(map[LogStreamKey]context.CancelFunc),
	}
}

// StartStream begins tailing logs for the specified pod/container and streams
// each line to the Hub as an EVENT_LOG_LINE WebSocket event scoped to clusterID.
// Calling StartStream for an already-active key is a no-op (idempotent).
func (ls *PodLogStreamer) StartStream(
	parentCtx context.Context,
	clientset kubernetes.Interface,
	clusterID, namespace, podName, container string,
	tailLines int64,
) error {
	key := LogStreamKey{
		ClusterID: clusterID,
		Namespace: namespace,
		PodName:   podName,
		Container: container,
	}

	ls.mu.Lock()
	if _, exists := ls.sessions[key]; exists {
		ls.mu.Unlock()
		log.Printf("[LogStreamer] Stream already active for %s/%s/%s on cluster %s — skipping",
			namespace, podName, container, clusterID)
		return nil
	}

	ctx, cancel := context.WithCancel(parentCtx)
	ls.sessions[key] = cancel
	ls.mu.Unlock()

	go ls.streamLoop(ctx, clientset, key, tailLines)
	return nil
}

// StopStream cancels the active log stream for the specified pod/container.
func (ls *PodLogStreamer) StopStream(clusterID, namespace, podName, container string) {
	key := LogStreamKey{
		ClusterID: clusterID,
		Namespace: namespace,
		PodName:   podName,
		Container: container,
	}

	ls.mu.Lock()
	defer ls.mu.Unlock()

	if cancel, exists := ls.sessions[key]; exists {
		cancel()
		delete(ls.sessions, key)
		log.Printf("[LogStreamer] Stopped stream for %s/%s/%s on cluster %s",
			namespace, podName, container, clusterID)
	}
}

// StopAllForCluster cancels every active log stream session for a given cluster.
// Called when a cluster is unregistered from the ClusterManager.
func (ls *PodLogStreamer) StopAllForCluster(clusterID string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()

	count := 0
	for key, cancel := range ls.sessions {
		if key.ClusterID == clusterID {
			cancel()
			delete(ls.sessions, key)
			count++
		}
	}
	if count > 0 {
		log.Printf("[LogStreamer] Stopped %d log stream(s) for cluster %s", count, clusterID)
	}
}

// ActiveStreamCount returns the total number of currently active log stream sessions.
func (ls *PodLogStreamer) ActiveStreamCount() int {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return len(ls.sessions)
}

// streamLoop is the internal goroutine that wraps client-go GetLogs with Follow:true,
// reads each line from the pod stdout/stderr stream, and emits it as a WebSocket event.
// It automatically retries with exponential backoff on transient connection errors.
func (ls *PodLogStreamer) streamLoop(
	ctx context.Context,
	clientset kubernetes.Interface,
	key LogStreamKey,
	tailLines int64,
) {
	defer func() {
		// Ensure the session is removed from the registry when the goroutine exits
		ls.mu.Lock()
		delete(ls.sessions, key)
		ls.mu.Unlock()
		log.Printf("[LogStreamer] Stream goroutine exited for %s/%s/%s on cluster %s",
			key.Namespace, key.PodName, key.Container, key.ClusterID)
	}()

	backoff := 1 * time.Second
	const maxBackoff = 30 * time.Second

	for {
		// Check for cancellation before each (re)connect attempt
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := ls.doStream(ctx, clientset, key, tailLines)
		if err == nil || ctx.Err() != nil {
			// Either clean shutdown or context cancelled — exit without retry
			return
		}

		log.Printf("[LogStreamer] Stream error for %s/%s/%s: %v — retrying in %s",
			key.Namespace, key.PodName, key.Container, err, backoff)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
			backoff = min(backoff*2, maxBackoff)
		}
	}
}

// doStream opens a single GetLogs streaming request and reads lines until EOF or ctx cancel.
func (ls *PodLogStreamer) doStream(
	ctx context.Context,
	clientset kubernetes.Interface,
	key LogStreamKey,
	tailLines int64,
) error {
	opts := &corev1.PodLogOptions{
		Container: key.Container,
		Follow:    true,
		TailLines: &tailLines,
		// Timestamps prepended by kubelet allow the client to reconstruct ordering
		Timestamps: true,
	}

	req := clientset.CoreV1().Pods(key.Namespace).GetLogs(key.PodName, opts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return fmt.Errorf("failed to open log stream for pod %s/%s: %w",
			key.Namespace, key.PodName, err)
	}
	defer stream.Close()

	log.Printf("[LogStreamer] Streaming logs for pod %s/%s (container: %s) on cluster %s",
		key.Namespace, key.PodName, key.Container, key.ClusterID)

	scanner := bufio.NewScanner(stream)
	// Allow log lines up to 1 MiB (handles verbose stack traces)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		// Respect context cancellation between lines
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		ls.hub.BroadcastEvent(types.EventLogLine, key.ClusterID, types.LogStreamEvent{
			PodName:   key.PodName,
			Namespace: key.Namespace,
			Container: key.Container,
			Log:       line,
			Stream:    "stdout", // kubectl logs API merges stdout/stderr by default
			Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		})

		// Inline anomaly detection: scan every log line for known failure patterns
		// (OOMKilled, panic, fatal error, ImagePullBackOff, etc.) and emit a
		// high-priority anomaly alert alongside the raw log line event.
		if match := AnalyzeLogLine(line); match != nil {
			ls.hub.BroadcastEvent(types.EventPodAnomalyDetected, key.ClusterID, types.PodAnomalyEvent{
				PodName:     key.PodName,
				Namespace:   key.Namespace,
				Container:   key.Container,
				AnomalyType: match.AnomalyType,
				Severity:    match.Severity,
				Message:     match.Message,
				LogSnippet:  line,
				Source:      "log_stream",
				Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
			})
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			// Context cancelled — not an error
			return nil
		}
		return fmt.Errorf("log scanner error for pod %s/%s: %w", key.Namespace, key.PodName, err)
	}

	// EOF — pod may have completed or restarted; caller will retry
	return io.EOF
}

// resolveContainer returns the first container name in a pod spec if the requested
// container name is empty — mirrors kubectl's default container resolution behaviour.
func resolveContainer(clientset kubernetes.Interface, namespace, podName, container string) (string, error) {
	if container != "" {
		return container, nil
	}
	pod, err := clientset.CoreV1().Pods(namespace).Get(context.Background(), podName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to fetch pod %s/%s to resolve container: %w", namespace, podName, err)
	}
	if len(pod.Spec.Containers) == 0 {
		return "", fmt.Errorf("pod %s/%s has no containers", namespace, podName)
	}
	return pod.Spec.Containers[0].Name, nil
}

// min is a helper — Go 1.21+ has built-in min; kept here for compatibility with Go 1.22 module header.
func min(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
