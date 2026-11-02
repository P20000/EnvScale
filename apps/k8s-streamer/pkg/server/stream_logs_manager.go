package server

import (
	"bufio"
	"context"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ContainerTarget struct {
	Namespace     string
	PodName       string
	ContainerName string
	IsInit        bool
	SourceID      string // "namespace/podName/containerName"
}

type ContainerStreamState struct {
	Target      ContainerTarget
	Status      string // "active" | "retrying" | "backoff" | "failed" | "terminated"
	Reason      string
	RetryCount  int
	LastSeen    time.Time
	CancelFunc  context.CancelFunc
}

type LogStreamManager struct {
	clientset kubernetes.Interface
	outChan   chan<- interface{}
	states    map[string]*ContainerStreamState
	mu        sync.RWMutex
}

func NewLogStreamManager(clientset kubernetes.Interface, outChan chan<- interface{}) *LogStreamManager {
	return &LogStreamManager{
		clientset: clientset,
		outChan:   outChan,
		states:    make(map[string]*ContainerStreamState),
	}
}

func (m *LogStreamManager) DiscoverContainers(
	ctx context.Context,
	namespace, name, kind string,
) ([]ContainerTarget, error) {
	cleanNs := strings.TrimSpace(namespace)
	isAllNamespaces := cleanNs == "" || strings.EqualFold(cleanNs, "all") || strings.EqualFold(cleanNs, "_all")

	listNs := cleanNs
	if isAllNamespaces {
		listNs = metav1.NamespaceAll
	}

	podList, err := m.clientset.CoreV1().Pods(listNs).List(ctx, metav1.ListOptions{})
	if err != nil {
		if errors.IsForbidden(err) || strings.Contains(strings.ToLower(err.Error()), "forbidden") {
			m.emitDiagnostic("system", listNs, "", "", "permission_denied", fmt.Sprintf("RBAC error listing pods: %v", err), 0, 0)
			if isAllNamespaces {
				// Graceful degradation: list pods in default namespace if all-namespaces is forbidden
				podList, err = m.clientset.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
			}
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list pods in namespace %q: %w", listNs, err)
		}
	}

	cleanName := strings.ToLower(strings.TrimSpace(name))
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))
	isAllResources := cleanName == "" || cleanName == "all" || cleanName == "all-resources" || normalizedKind == "all"

	var targets []ContainerTarget
	for _, pod := range podList.Items {
		pName := strings.ToLower(pod.Name)
		matches := false

		if isAllResources {
			matches = true
		} else if normalizedKind == "pod" {
			matches = pName == cleanName
		} else {
			// Workload matching (deployments, statefulsets, jobs, or prefix match)
			matches = strings.HasPrefix(pName, cleanName) || strings.Contains(pName, cleanName)
		}

		if !matches {
			continue
		}

		// Include app containers
		for _, c := range pod.Spec.Containers {
			targets = append(targets, ContainerTarget{
				Namespace:     pod.Namespace,
				PodName:       pod.Name,
				ContainerName: c.Name,
				IsInit:        false,
				SourceID:      fmt.Sprintf("%s/%s/%s", pod.Namespace, pod.Name, c.Name),
			})
		}

		// Include init containers that are executing or failed
		for _, ic := range pod.Spec.InitContainers {
			includeInit := false
			for _, st := range pod.Status.InitContainerStatuses {
				if st.Name == ic.Name {
					if st.State.Running != nil || (st.State.Terminated != nil && st.State.Terminated.ExitCode != 0) {
						includeInit = true
					}
					break
				}
			}
			if includeInit {
				targets = append(targets, ContainerTarget{
					Namespace:     pod.Namespace,
					PodName:       pod.Name,
					ContainerName: ic.Name,
					IsInit:        true,
					SourceID:      fmt.Sprintf("%s/%s/%s", pod.Namespace, pod.Name, ic.Name),
				})
			}
		}
	}

	return targets, nil
}

func (m *LogStreamManager) StartStreams(
	ctx context.Context,
	targets []ContainerTarget,
	initialTailLines int64,
	scope string,
) {
	if len(targets) == 0 {
		m.emitStatus(scope)
		return
	}

	// Dynamic initial tail lines per container when streaming wide scope
	perContainerTail := initialTailLines
	if len(targets) > 1 && initialTailLines > 30 {
		perContainerTail = 30
	}

	var wg sync.WaitGroup
	for _, target := range targets {
		childCtx, childCancel := context.WithCancel(ctx)
		m.mu.Lock()
		m.states[target.SourceID] = &ContainerStreamState{
			Target:     target,
			Status:     "active",
			Reason:     "Initializing stream",
			CancelFunc: childCancel,
		}
		m.mu.Unlock()

		wg.Add(1)
		go func(t ContainerTarget, cCtx context.Context) {
			defer wg.Done()
			m.runContainerWorker(cCtx, t, perContainerTail)
		}(target, childCtx)
	}

	m.emitStatus(scope)
	wg.Wait()
}

func (m *LogStreamManager) runContainerWorker(
	ctx context.Context,
	target ContainerTarget,
	initialTailLines int64,
) {
	var lastTimestamp time.Time
	retryCount := 0
	baseBackoff := 1 * time.Second
	maxBackoff := 30 * time.Second
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	for ctx.Err() == nil {
		// 1. Inspect Pod & Container lifecycle status
		pod, err := m.clientset.CoreV1().Pods(target.Namespace).Get(ctx, target.PodName, metav1.GetOptions{})
		if err != nil {
			if errors.IsNotFound(err) {
				m.updateState(target, "terminated", "Pod deleted", retryCount)
				return
			}
			m.updateState(target, "retrying", fmt.Sprintf("Error inspecting pod: %v", err), retryCount)
		} else {
			terminated, exitCode := isContainerTerminated(pod, target.ContainerName, target.IsInit)
			if terminated {
				if exitCode == 0 {
					// Container finished successfully. Read remaining unread logs once then terminate cleanly.
					m.drainContainerLogs(ctx, target, lastTimestamp, initialTailLines)
					m.updateState(target, "terminated", "Container completed successfully (exit 0)", retryCount)
					return
				}
				if pod.Spec.RestartPolicy == corev1.RestartPolicyNever {
					m.drainContainerLogs(ctx, target, lastTimestamp, initialTailLines)
					m.updateState(target, "failed", fmt.Sprintf("Container terminated with exit code %d", exitCode), retryCount)
					return
				}
			}

			waiting, reason := isContainerWaiting(pod, target.ContainerName, target.IsInit)
			if waiting {
				retryCount++
				if retryCount > 15 {
					m.updateState(target, "failed", fmt.Sprintf("Container failed to start after 15 retries: %s", reason), retryCount)
					return
				}
				jitter := time.Duration(rng.Int63n(int64(1000 * time.Millisecond)))
				backoff := minDuration(maxBackoff, baseBackoff*(1<<min(retryCount, 5))) + jitter
				m.updateStateWithRetry(target, "retrying", fmt.Sprintf("Container waiting: %s", reason), retryCount, backoff.Milliseconds())
				select {
				case <-time.After(backoff):
					continue
				case <-ctx.Done():
					return
				}
			}
		}

		// 2. Open log stream
		logOpts := &corev1.PodLogOptions{
			Container:  target.ContainerName,
			Follow:     true,
			Timestamps: true,
		}
		if !lastTimestamp.IsZero() {
			// Prevent duplicate ingestion across reconnect boundaries
			since := metav1.NewTime(lastTimestamp.Add(time.Nanosecond))
			logOpts.SinceTime = &since
		} else if initialTailLines > 0 {
			tail := initialTailLines
			logOpts.TailLines = &tail
		}

		req := m.clientset.CoreV1().Pods(target.Namespace).GetLogs(target.PodName, logOpts)
		stream, err := req.Stream(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			retryCount++
			if retryCount > 20 {
				m.updateState(target, "failed", fmt.Sprintf("Exceeded max retries opening stream: %v", err), retryCount)
				return
			}

			jitter := time.Duration(rng.Int63n(int64(1000 * time.Millisecond)))
			backoff := minDuration(maxBackoff, baseBackoff*(1<<min(retryCount, 4))) + jitter
			m.updateStateWithRetry(target, "retrying", fmt.Sprintf("Stream open failed: %v", err), retryCount, backoff.Milliseconds())

			select {
			case <-time.After(backoff):
				continue
			case <-ctx.Done():
				return
			}
		}

		// 3. Successfully opened stream
		m.updateState(target, "active", "Streaming container stdout/stderr", 0)
		retryCount = 0

		scanner := bufio.NewScanner(stream)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)

		for scanner.Scan() {
			select {
			case <-ctx.Done():
				stream.Close()
				return
			default:
				rawLine := scanner.Text()
				ts, parsedTime, level, cleanMsg := parseLogTimestamp(rawLine)
				if !parsedTime.IsZero() {
					lastTimestamp = parsedTime
				}

				select {
				case m.outChan <- StreamLogMessage{
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
				}:
				case <-ctx.Done():
					stream.Close()
					return
				}
			}
		}

		stream.Close()
		if ctx.Err() != nil {
			return
		}

		// Stream disconnected or reached EOF
		if scanErr := scanner.Err(); scanErr != nil {
			m.updateState(target, "retrying", fmt.Sprintf("Stream interrupted: %v", scanErr), retryCount+1)
		} else {
			m.updateState(target, "retrying", "Stream closed by server; reconnecting", retryCount+1)
		}

		jitter := time.Duration(rng.Int63n(int64(1000 * time.Millisecond)))
		select {
		case <-time.After(1*time.Second + jitter):
		case <-ctx.Done():
			return
		}
	}
}

func (m *LogStreamManager) drainContainerLogs(
	ctx context.Context,
	target ContainerTarget,
	lastTimestamp time.Time,
	initialTailLines int64,
) {
	logOpts := &corev1.PodLogOptions{
		Container:  target.ContainerName,
		Follow:     false,
		Timestamps: true,
	}
	if !lastTimestamp.IsZero() {
		since := metav1.NewTime(lastTimestamp.Add(time.Nanosecond))
		logOpts.SinceTime = &since
	} else if initialTailLines > 0 {
		tail := initialTailLines
		logOpts.TailLines = &tail
	}

	req := m.clientset.CoreV1().Pods(target.Namespace).GetLogs(target.PodName, logOpts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if ctx.Err() != nil {
			return
		}
		rawLine := scanner.Text()
		ts, _, level, cleanMsg := parseLogTimestamp(rawLine)
		select {
		case m.outChan <- StreamLogMessage{
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
		}:
		case <-ctx.Done():
			return
		}
	}
}

func (m *LogStreamManager) updateState(target ContainerTarget, status, reason string, retryCount int) {
	m.updateStateWithRetry(target, status, reason, retryCount, 0)
}

func (m *LogStreamManager) updateStateWithRetry(target ContainerTarget, status, reason string, retryCount int, nextRetryMs int64) {
	m.mu.Lock()
	if st, ok := m.states[target.SourceID]; ok {
		st.Status = status
		st.Reason = reason
		st.RetryCount = retryCount
		st.LastSeen = time.Now()
	}
	m.mu.Unlock()

	m.emitDiagnostic(target.SourceID, target.Namespace, target.PodName, target.ContainerName, status, reason, retryCount, nextRetryMs)
}

func (m *LogStreamManager) emitDiagnostic(source, ns, pod, container, status, reason string, retryCount int, nextRetryMs int64) {
	diag := StreamDiagnosticMessage{
		Type:        "diagnostic",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Source:      source,
		Namespace:   ns,
		Pod:         pod,
		Container:   container,
		Status:      status,
		Reason:      reason,
		RetryCount:  retryCount,
		NextRetryMs: nextRetryMs,
	}
	select {
	case m.outChan <- diag:
	default:
	}
}

func (m *LogStreamManager) emitStatus(scope string) {
	m.mu.RLock()
	total := len(m.states)
	active, retrying, failed := 0, 0, 0
	for _, st := range m.states {
		switch st.Status {
		case "active":
			active++
		case "retrying", "backoff":
			retrying++
		case "failed", "permission_denied":
			failed++
		}
	}
	m.mu.RUnlock()

	statusMsg := StreamStatusMessage{
		Type:            "status",
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		TotalStreams:    total,
		ActiveStreams:   active,
		RetryingStreams: retrying,
		FailedStreams:   failed,
		Scope:           scope,
	}
	select {
	case m.outChan <- statusMsg:
	default:
	}
}
