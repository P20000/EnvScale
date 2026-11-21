package server

import (
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
)

func isContainerTerminated(pod *corev1.Pod, containerName string, isInit bool) (bool, int32) {
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

func isContainerWaiting(pod *corev1.Pod, containerName string, isInit bool) (bool, string) {
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

func parseLogTimestamp(raw string) (string, time.Time, string, string) {
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

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
