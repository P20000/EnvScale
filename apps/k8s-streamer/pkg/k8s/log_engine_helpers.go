package k8s

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

// DefaultMaxLogLineBytes caps any single log entry at 256 KiB (safely above 64 KiB
// bufio.Scanner limits while preventing unbounded per-line heap growth).
const DefaultMaxLogLineBytes = 256 * 1024

// Domain errors emitted by LogEngine for unified Direct/Agent classification.
var (
	ErrLogPermissionDenied  = errors.New("kubernetes log permission denied")
	ErrLogResourceNotFound  = errors.New("kubernetes log resource not found")
	ErrLogContainerNotFound = errors.New("kubernetes container not found in target pod")
)

// ContainerTarget identifies a specific container stream source.
type ContainerTarget struct {
	Namespace     string
	PodName       string
	ContainerName string
	IsInit        bool
	SourceID      string // "namespace/podName/containerName"
}

// readBoundedLogLine reads one newline-delimited log entry without allocating more than
// maxBytes in RAM. Lines longer than maxBytes are truncated cleanly and remaining bytes
// up to '\n' are discarded so subsequent log lines keep streaming.
func readBoundedLogLine(r *bufio.Reader, maxBytes int) (line string, truncated bool, err error) {
	if maxBytes <= 0 {
		maxBytes = DefaultMaxLogLineBytes
	}

	var buf []byte
	discarding := false
	for {
		chunk, readErr := r.ReadSlice('\n')
		if !discarding && len(chunk) > 0 {
			rem := maxBytes - len(buf)
			if len(chunk) <= rem {
				buf = append(buf, chunk...)
			} else {
				if rem > 0 {
					buf = append(buf, chunk[:rem]...)
				}
				// Only mark truncated if extra bytes aren't merely trailing \r or \n.
				extra := strings.TrimRight(string(chunk[rem:]), "\r\n")
				if len(extra) > 0 {
					truncated = true
				}
				discarding = true
			}
		} else if discarding && len(chunk) > 0 {
			if strings.TrimRight(string(chunk), "\r\n") != "" {
				truncated = true
			}
		}

		if readErr == nil {
			break
		}
		if readErr == bufio.ErrBufferFull {
			continue
		}
		if readErr == io.EOF {
			if len(buf) == 0 && !truncated {
				return "", false, io.EOF
			}
			break
		}
		return strings.TrimRight(string(buf), "\r\n"), truncated, readErr
	}

	out := strings.TrimRight(string(buf), "\r\n")
	if len(out) > maxBytes {
		out = out[:maxBytes]
		truncated = true
	}
	return out, truncated, nil
}

// followResumeState implements best-effort boundary duplicate suppression on follow retries.
// Because Kubernetes pods/log sinceTime queries operate at 1-second precision, reconnects
// re-query from the last seen second and suppress previously seen line occurrences within
// that boundary second while allowing new entries sharing the same second to pass through.
type followResumeState struct {
	lastTimestamp   time.Time
	lastSecond      time.Time
	boundaryCounts  map[string]int
	replayRemaining map[string]int
	containerID     string
	restartCount    int32
	initialized     bool
}

func (s *followResumeState) resetForRestart(containerID string, restartCount int32) {
	s.lastTimestamp = time.Time{}
	s.lastSecond = time.Time{}
	s.boundaryCounts = nil
	s.replayRemaining = nil
	s.containerID = containerID
	s.restartCount = restartCount
	s.initialized = true
}

func (s *followResumeState) beginReconnect() {
	if len(s.boundaryCounts) == 0 {
		s.replayRemaining = nil
		return
	}
	s.replayRemaining = make(map[string]int, len(s.boundaryCounts))
	for k, v := range s.boundaryCounts {
		s.replayRemaining[k] = v
	}
}

func (s *followResumeState) shouldSuppressAndRecord(parsedTime time.Time, rawLine string) bool {
	if parsedTime.IsZero() {
		return false
	}
	sec := parsedTime.UTC().Truncate(time.Second)

	if !s.lastSecond.IsZero() && sec.Equal(s.lastSecond) && s.replayRemaining != nil {
		if rem := s.replayRemaining[rawLine]; rem > 0 {
			s.replayRemaining[rawLine] = rem - 1
			return true
		}
	}

	if parsedTime.After(s.lastTimestamp) {
		s.lastTimestamp = parsedTime
	}
	if s.lastSecond.IsZero() || !sec.Equal(s.lastSecond) {
		s.lastSecond = sec
		s.boundaryCounts = make(map[string]int, 8)
		s.replayRemaining = nil
	}
	if len(s.boundaryCounts) < 512 {
		s.boundaryCounts[rawLine]++
	}
	return false
}

// containerRuntimeIdentity returns the containerID and restartCount for pod lifecycle tracking.
func containerRuntimeIdentity(pod *corev1.Pod, containerName string, isInit bool) (string, int32, bool) {
	if pod == nil {
		return "", 0, false
	}
	statuses := pod.Status.ContainerStatuses
	if isInit {
		statuses = pod.Status.InitContainerStatuses
	}
	for _, st := range statuses {
		if st.Name == containerName {
			return st.ContainerID, st.RestartCount, true
		}
	}
	return "", 0, false
}

// IsContainerTerminated reports whether containerName has terminated and its exit code.
func IsContainerTerminated(pod *corev1.Pod, containerName string, isInit bool) (bool, int32) {
	statuses := pod.Status.ContainerStatuses
	if isInit {
		statuses = pod.Status.InitContainerStatuses
	}
	for _, st := range statuses {
		if st.Name == containerName && st.State.Terminated != nil {
			return true, st.State.Terminated.ExitCode
		}
	}
	return false, 0
}

// IsContainerWaiting reports whether containerName is in a Waiting state and its reason.
func IsContainerWaiting(pod *corev1.Pod, containerName string, isInit bool) (bool, string) {
	statuses := pod.Status.ContainerStatuses
	if isInit {
		statuses = pod.Status.InitContainerStatuses
	}
	for _, st := range statuses {
		if st.Name == containerName && st.State.Waiting != nil {
			msg := st.State.Waiting.Reason
			if st.State.Waiting.Message != "" {
				msg = fmt.Sprintf("%s: %s", msg, st.State.Waiting.Message)
			}
			return true, msg
		}
	}
	return false, ""
}

// ParseLogTimestamp strips kubelet RFC3339/RFC3339Nano prefixes and infers severity level.
func ParseLogTimestamp(raw string) (string, time.Time, string, string) {
	parts := strings.SplitN(raw, " ", 2)
	now := time.Now().UTC()
	tsStr := now.Format(time.RFC3339)
	var parsedTime time.Time
	msg := raw

	if len(parts) == 2 {
		if t, err := time.Parse(time.RFC3339Nano, parts[0]); err == nil {
			parsedTime = t
			tsStr = parts[0]
			msg = parts[1]
		} else if t, err := time.Parse(time.RFC3339, parts[0]); err == nil {
			parsedTime = t
			tsStr = parts[0]
			msg = parts[1]
		}
	}

	upper := strings.ToUpper(msg)
	lvl := "INFO"
	if strings.Contains(upper, "ERROR") || strings.Contains(upper, "FAIL") || strings.Contains(upper, "FATAL") {
		lvl = "ERROR"
	} else if strings.Contains(upper, "WARN") {
		lvl = "WARN"
	} else if strings.Contains(upper, "DEBUG") || strings.Contains(upper, "TRACE") {
		lvl = "DEBUG"
	}

	return tsStr, parsedTime, lvl, msg
}

// ClassifyK8sLogError maps Kubernetes/transport errors to normalized stream error codes.
func ClassifyK8sLogError(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, ErrLogPermissionDenied) || apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) ||
		strings.Contains(strings.ToLower(err.Error()), "forbidden") {
		return "permission_denied"
	}
	if errors.Is(err, ErrLogResourceNotFound) || errors.Is(err, ErrLogContainerNotFound) || apierrors.IsNotFound(err) {
		return "not_found"
	}
	if apierrors.IsBadRequest(err) || apierrors.IsInvalid(err) {
		return "bad_request"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	return "stream_error"
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
