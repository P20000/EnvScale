package k8s

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

const defaultMaxEngineDropped = 4096

var errBackpressureExhausted = errors.New("log stream terminated due to sustained consumer backpressure")

type streamTracker struct {
	Target     ContainerTarget
	Status     string
	Reason     string
	RetryCount int
}

// LogEngine executes transport-neutral Kubernetes pod/workload log streaming into a normalized frame sink.
// Guarantees:
// - Strictly monotonic per-stream Sequence numbers across emitted and dropped frames.
// - Explicit backpressure diagnostics (with dropped count + sequence gap) before resuming or terminating on resource exhaustion.
// - Best-effort boundary duplicate suppression on follow retries (limited by Kubernetes pods/log 1s sinceTime precision; resets on container restart).
type LogEngine struct {
	clientset        kubernetes.Interface
	clusterID        string
	streamID         string
	sessionID        string
	sink             chan<- types.LogStreamFrame
	seq              atomic.Uint64
	maxLineBytes     int
	maxDropped       uint64
	retryBaseBackoff time.Duration

	mu             sync.RWMutex
	states         map[string]*streamTracker
	backpressureMu sync.Mutex
	pendingDropped uint64
	dropGapStart   uint64
	dropGapEnd     uint64
	totalDropped   uint64
}

// NewLogEngine constructs a LogEngine emitting normalized frames to sink.
func NewLogEngine(clientset kubernetes.Interface, clusterID, streamID, sessionID string, sink chan<- types.LogStreamFrame) *LogEngine {
	return &LogEngine{
		clientset:        clientset,
		clusterID:        clusterID,
		streamID:         streamID,
		sessionID:        sessionID,
		sink:             sink,
		maxLineBytes:     DefaultMaxLogLineBytes,
		maxDropped:       defaultMaxEngineDropped,
		retryBaseBackoff: time.Second,
		states:           make(map[string]*streamTracker),
	}
}

// SetLimits configures line-size, backpressure drop ceiling, and retry backoff for testing or tuning.
func (e *LogEngine) SetLimits(maxLineBytes int, maxDropped uint64, retryBackoff time.Duration) {
	if maxLineBytes > 0 {
		e.maxLineBytes = maxLineBytes
	}
	if maxDropped > 0 {
		e.maxDropped = maxDropped
	}
	if retryBackoff > 0 {
		e.retryBaseBackoff = retryBackoff
	}
}

// Run executes log streaming until completion (follow=false), unrecoverable error, or ctx cancellation.
func (e *LogEngine) Run(ctx context.Context, req types.LogStreamStartPayload) error {
	normKind := strings.ToLower(strings.TrimSpace(req.Kind))
	if normKind == "service" || normKind == "ingress" || normKind == "node" {
		targetNs := req.Namespace
		if targetNs == "" || strings.EqualFold(targetNs, "all") || strings.EqualFold(targetNs, "_all") {
			targetNs = "default"
		}
		return e.runResourceEvents(ctx, targetNs, req.Name, req.Kind, req.Follow)
	}

	targets, err := e.DiscoverContainers(ctx, req.Namespace, req.Name, req.Kind, req.Container)
	if err != nil {
		code := ClassifyK8sLogError(err)
		status := "failed"
		if code == "permission_denied" {
			status = "permission_denied"
		}
		e.emitDiagnostic(ctx, "system", req.Namespace, req.Name, req.Container, status, err.Error(), 0, 0)
		_, _ = e.emitFrame(ctx, types.LogStreamFrame{
			Type:      "error",
			Namespace: req.Namespace,
			Pod:       req.Name,
			Container: req.Container,
			Status:    status,
			Code:      code,
			Reason:    err.Error(),
		})
		return err
	}

	scope := req.Namespace
	if scope == "" || strings.EqualFold(scope, "all") || strings.EqualFold(scope, "_all") {
		scope = "all"
	}

	if len(targets) == 0 {
		e.emitStatus(ctx, scope)
		if !req.Follow {
			_, _ = e.emitFrame(ctx, types.LogStreamFrame{
				Type:   "end",
				Status: "ended",
				Reason: "No matching containers found",
			})
		} else {
			<-ctx.Done()
		}
		return nil
	}

	perContainerTail := req.TailLines
	if len(targets) > 1 && perContainerTail > 30 {
		perContainerTail = 30
	}

	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()

	var wg sync.WaitGroup
	var errMu sync.Mutex
	var firstErr error
	for _, target := range targets {
		e.mu.Lock()
		e.states[target.SourceID] = &streamTracker{
			Target: target,
			Status: "active",
			Reason: "Initializing stream",
		}
		e.mu.Unlock()

		wg.Add(1)
		go func(t ContainerTarget) {
			defer wg.Done()
			if wErr := e.runTargetWorker(runCtx, t, req, perContainerTail); wErr != nil {
				errMu.Lock()
				if firstErr == nil {
					firstErr = wErr
				}
				errMu.Unlock()
				if errors.Is(wErr, errBackpressureExhausted) {
					cancelRun()
				}
			}
		}(target)
	}

	e.emitStatus(runCtx, scope)
	wg.Wait()

	if firstErr != nil && errors.Is(firstErr, errBackpressureExhausted) {
		_, _ = e.emitFrame(ctx, types.LogStreamFrame{
			Type:   "error",
			Status: "failed",
			Code:   "resource_exhausted",
			Reason: firstErr.Error(),
		})
		return firstErr
	}

	if ctx.Err() == nil {
		if firstErr != nil && len(targets) == 1 {
			_, _ = e.emitFrame(ctx, types.LogStreamFrame{
				Type:      "error",
				Namespace: targets[0].Namespace,
				Pod:       targets[0].PodName,
				Container: targets[0].ContainerName,
				Status:    "failed",
				Code:      ClassifyK8sLogError(firstErr),
				Reason:    firstErr.Error(),
			})
			return firstErr
		}
		_, _ = e.emitFrame(ctx, types.LogStreamFrame{
			Type:   "end",
			Status: "ended",
			Reason: "Stream completed",
		})
	}
	return nil
}

func (e *LogEngine) runTargetWorker(ctx context.Context, target ContainerTarget, req types.LogStreamStartPayload, tailLines int64) error {
	if !req.Follow {
		return e.streamOnce(ctx, target, req, tailLines, nil, false)
	}

	resume := &followResumeState{}
	retryCount := 0
	baseBackoff := e.retryBaseBackoff
	if baseBackoff <= 0 {
		baseBackoff = time.Second
	}
	maxBackoff := 30 * time.Second
	if baseBackoff < 100*time.Millisecond {
		maxBackoff = 500 * time.Millisecond
	}
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	for ctx.Err() == nil {
		pod, err := e.clientset.CoreV1().Pods(target.Namespace).Get(ctx, target.PodName, metav1.GetOptions{})
		if err != nil {
			if apierrors.IsForbidden(err) {
				e.updateState(ctx, target, "permission_denied", fmt.Sprintf("RBAC denied inspecting pod: %v", err), retryCount, 0)
				return fmt.Errorf("%w: %v", ErrLogPermissionDenied, err)
			}
			if apierrors.IsNotFound(err) {
				e.updateState(ctx, target, "terminated", "Pod deleted", retryCount, 0)
				return nil
			}
		} else {
			if cid, restarts, ok := containerRuntimeIdentity(pod, target.ContainerName, target.IsInit); ok {
				if !resume.initialized {
					resume.containerID = cid
					resume.restartCount = restarts
					resume.initialized = true
				} else if (cid != "" && resume.containerID != "" && cid != resume.containerID) || restarts > resume.restartCount {
					resume.resetForRestart(cid, restarts)
					e.updateState(ctx, target, "restarted", fmt.Sprintf("Container restarted (restartCount=%d); resetting resume watermark", restarts), 0, 0)
				}
			}
			terminated, exitCode := IsContainerTerminated(pod, target.ContainerName, target.IsInit)
			if terminated {
				if exitCode == 0 {
					_ = e.streamOnce(ctx, target, req, tailLines, resume, false)
					e.updateState(ctx, target, "terminated", "Container completed successfully (exit 0)", retryCount, 0)
					return nil
				}
				if pod.Spec.RestartPolicy == corev1.RestartPolicyNever {
					_ = e.streamOnce(ctx, target, req, tailLines, resume, false)
					e.updateState(ctx, target, "failed", fmt.Sprintf("Container terminated with exit code %d", exitCode), retryCount, 0)
					return nil
				}
			}
			if waiting, reason := IsContainerWaiting(pod, target.ContainerName, target.IsInit); waiting {
				retryCount++
				if retryCount > 15 {
					e.updateState(ctx, target, "failed", fmt.Sprintf("Container failed to start after 15 retries: %s", reason), retryCount, 0)
					return nil
				}
				backoff := minDuration(maxBackoff, baseBackoff*(1<<minInt(retryCount, 5))) + time.Duration(rng.Int63n(int64(baseBackoff/2+time.Millisecond)))
				e.updateState(ctx, target, "retrying", fmt.Sprintf("Container waiting: %s", reason), retryCount, backoff.Milliseconds())
				select {
				case <-time.After(backoff):
					continue
				case <-ctx.Done():
					return nil
				}
			}
		}

		streamErr := e.streamOnce(ctx, target, req, tailLines, resume, true)
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(streamErr, errBackpressureExhausted) {
			return streamErr
		}
		if streamErr != nil && ClassifyK8sLogError(streamErr) == "permission_denied" {
			e.updateState(ctx, target, "permission_denied", streamErr.Error(), retryCount, 0)
			return streamErr
		}
		if streamErr != nil && apierrors.IsNotFound(streamErr) {
			e.updateState(ctx, target, "terminated", "Pod or container no longer exists", retryCount, 0)
			return nil
		}

		resume.beginReconnect()
		retryCount++
		if streamErr != nil && streamErr != io.EOF && retryCount > 20 {
			e.updateState(ctx, target, "failed", fmt.Sprintf("Exceeded max retries opening stream: %v", streamErr), retryCount, 0)
			return streamErr
		}
		reason := "Stream closed by server; reconnecting"
		if streamErr != nil && streamErr != io.EOF {
			reason = fmt.Sprintf("Stream error: %v", streamErr)
		}
		backoff := minDuration(maxBackoff, baseBackoff*(1<<minInt(retryCount, 4))) + time.Duration(rng.Int63n(int64(baseBackoff/2+time.Millisecond)))
		e.updateState(ctx, target, "retrying", reason, retryCount, backoff.Milliseconds())
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return nil
		}
	}
	return nil
}

func (e *LogEngine) streamOnce(
	ctx context.Context,
	target ContainerTarget,
	req types.LogStreamStartPayload,
	tailLines int64,
	resume *followResumeState,
	follow bool,
) error {
	opts := &corev1.PodLogOptions{
		Container:  target.ContainerName,
		Follow:     follow,
		Previous:   req.Previous,
		Timestamps: req.Timestamps,
	}
	if resume != nil && !resume.lastTimestamp.IsZero() {
		// Re-query from lastTimestamp (1s K8s precision) and suppress seen boundary occurrences via resume state.
		since := metav1.NewTime(resume.lastTimestamp)
		opts.SinceTime = &since
	} else if req.SinceTime != nil {
		since := metav1.NewTime(*req.SinceTime)
		opts.SinceTime = &since
	} else if req.SinceSeconds != nil && *req.SinceSeconds > 0 {
		s := *req.SinceSeconds
		opts.SinceSeconds = &s
	} else if tailLines > 0 {
		t := tailLines
		opts.TailLines = &t
	}

	stream, err := e.clientset.CoreV1().Pods(target.Namespace).GetLogs(target.PodName, opts).Stream(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return err
	}
	defer stream.Close()

	e.updateState(ctx, target, "active", "Streaming container stdout/stderr", 0, 0)

	reader := bufio.NewReaderSize(stream, 64*1024)
	for {
		if ctx.Err() != nil {
			return nil
		}
		rawLine, truncated, readErr := readBoundedLogLine(reader, e.maxLineBytes)
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return nil
			}
			return readErr
		}
		if truncated {
			rawLine += " ... [truncated]"
			e.emitFrame(ctx, types.LogStreamFrame{
				Type:      "diagnostic",
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				Source:    target.SourceID,
				Namespace: target.Namespace,
				Pod:       target.PodName,
				Container: target.ContainerName,
				Status:    "truncated",
				Code:      "log_line_truncated",
				Reason:    fmt.Sprintf("Oversized log line truncated to %d bytes", e.maxLineBytes),
			})
		}

		ts, parsedTime, level, cleanMsg := ParseLogTimestamp(rawLine)
		if resume != nil && resume.shouldSuppressAndRecord(parsedTime, rawLine) {
			continue
		}
		_, emitErr := e.emitFrame(ctx, types.LogStreamFrame{
			Type:      "log",
			Timestamp: ts,
			Namespace: target.Namespace,
			Pod:       target.PodName,
			Container: target.ContainerName,
			Source:    target.SourceID,
			Level:     level,
			Message:   cleanMsg,
			Stream:    "stdout",
			Kind:      "Pod",
		})
		if emitErr != nil {
			return emitErr
		}
	}
	if follow {
		return io.EOF
	}
	return nil
}
