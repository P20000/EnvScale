package server

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	envws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

type StreamLogMessage struct {
	Timestamp string `json:"timestamp"`
	Source    string `json:"source"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	Kind      string `json:"kind"`
}

var logUpgrader = websocket.Upgrader{
	CheckOrigin: envws.IsOriginAllowed,
}

func HandleUniversalLogStream(
	clusterManager *k8s.ClusterManager,
	w http.ResponseWriter,
	r *http.Request,
) {
	claims, err := envws.AuthenticateHandshake(r)
	if err != nil {
		http.Error(w, fmt.Sprintf("Unauthorized: %v", err), http.StatusUnauthorized)
		return
	}

	clusterID := r.URL.Query().Get("clusterId")
	if clusterID == "" {
		http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
		return
	}

	if err := envws.CheckClusterAuthorization(claims, clusterID); err != nil {
		http.Error(w, fmt.Sprintf("Forbidden: %v", err), http.StatusForbidden)
		return
	}


	conn, err := logUpgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Failed to upgrade to WebSocket", http.StatusBadRequest)
		return
	}
	defer conn.Close()


	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	logChan := make(chan StreamLogMessage, 200)
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for msg := range logChan {
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteJSON(msg); err != nil {
				cancel()
				return
			}
		}
	}()

	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "default"
	}

	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	tailLinesStr := r.URL.Query().Get("tailLines")

	var tailLines int64 = 100
	if tailLinesStr != "" {
		if parsed, err := strconv.ParseInt(tailLinesStr, 10, 64); err == nil && parsed > 0 {
			tailLines = parsed
		}
	}

	clientset, err := clusterManager.GetClientset(clusterID)
	if err != nil {
		isDevMode := os.Getenv("ALLOW_ANONYMOUS_WS") == "true" || os.Getenv("ENVSCALE_DEV_MODE") == "true" || os.Getenv("NODE_ENV") != "production"
		if isDevMode {
			streamFallbackTelemetry(ctx, namespace, name, kind, logChan)
			<-ctx.Done()
			close(logChan)
			wg.Wait()
			return
		}

		select {
		case logChan <- StreamLogMessage{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    "system",
			Level:     "ERROR",
			Message:   fmt.Sprintf("Failed to get clientset for cluster %s: %v", clusterID, err),
			Kind:      kind,
		}:
		case <-ctx.Done():
		}
		close(logChan)
		wg.Wait()
		return
	}

	normalizedKind := strings.ToLower(kind)
	switch normalizedKind {
	case "pod":
		streamPodLogs(ctx, clientset, namespace, name, tailLines, logChan)
	case "deployment", "statefulset", "replicaset", "workload", "group":
		streamWorkloadLogs(ctx, clientset, namespace, name, kind, tailLines, logChan)
	case "service", "ingress", "node":
		streamResourceEvents(ctx, clientset, namespace, name, kind, logChan)
	default:
		streamPodLogs(ctx, clientset, namespace, name, tailLines, logChan)
	}

	<-ctx.Done()
	close(logChan)
	wg.Wait()
}

func streamPodLogs(
	ctx context.Context,
	clientset kubernetes.Interface,
	namespace, podName string,
	tailLines int64,
	logChan chan<- StreamLogMessage,
) {
	pod, err := clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		isDevMode := os.Getenv("ALLOW_ANONYMOUS_WS") == "true" || os.Getenv("ENVSCALE_DEV_MODE") == "true" || os.Getenv("NODE_ENV") != "production"
		if isDevMode {
			streamFallbackTelemetry(ctx, namespace, podName, "Pod", logChan)
			return
		}

		select {
		case logChan <- StreamLogMessage{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    podName,
			Level:     "ERROR",
			Message:   fmt.Sprintf("Failed to get pod %s/%s: %v", namespace, podName, err),
			Kind:      "Pod",
		}:
		case <-ctx.Done():
		}
		return
	}

	var containers []string
	for _, c := range pod.Spec.Containers {
		containers = append(containers, c.Name)
	}

	if len(containers) == 0 {
		select {
		case logChan <- StreamLogMessage{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    podName,
			Level:     "WARN",
			Message:   fmt.Sprintf("No containers found in pod spec for %s", podName),
			Kind:      "Pod",
		}:
		case <-ctx.Done():
		}
		return
	}

	var containerWg sync.WaitGroup
	for _, cName := range containers {
		containerWg.Add(1)
		go func(c string) {
			defer containerWg.Done()

			req := clientset.CoreV1().Pods(namespace).GetLogs(podName, &corev1.PodLogOptions{
				Container:  c,
				Follow:     true,
				TailLines:  &tailLines,
				Timestamps: true,
			})

			stream, err := req.Stream(ctx)
			if err != nil {
				select {
				case logChan <- StreamLogMessage{
					Timestamp: time.Now().UTC().Format(time.RFC3339),
					Source:    fmt.Sprintf("%s/%s", podName, c),
					Level:     "WARN",
					Message:   fmt.Sprintf("Could not stream logs for container %s: %v", c, err),
					Kind:      "Pod",
				}:
				case <-ctx.Done():
				}
				return
			}
			defer stream.Close()

			scanner := bufio.NewScanner(stream)
			// Expand buffer capacity from 64KB up to 1MB to handle large stack traces and JSON logs
			scanner.Buffer(make([]byte, 64*1024), 1024*1024)

			for scanner.Scan() {
				select {
				case <-ctx.Done():
					return
				default:
					line := scanner.Text()
					ts, level, msg := parseLogLine(line)
					select {
					case logChan <- StreamLogMessage{
						Timestamp: ts,
						Source:    fmt.Sprintf("%s/%s", podName, c),
						Level:     level,
						Message:   msg,
						Kind:      "Pod",
					}:
					case <-ctx.Done():
						return
					}
				}
			}

			// Surface any scanning error (e.g. token too long or stream disconnect)
			if err := scanner.Err(); err != nil && ctx.Err() == nil {
				select {
				case logChan <- StreamLogMessage{
					Timestamp: time.Now().UTC().Format(time.RFC3339),
					Source:    fmt.Sprintf("%s/%s", podName, c),
					Level:     "WARN",
					Message:   fmt.Sprintf("Log stream ended with error: %v", err),
					Kind:      "Pod",
				}:
				case <-ctx.Done():
				}
			}
		}(cName)
	}

	containerWg.Wait()
}

func streamWorkloadLogs(
	ctx context.Context,
	clientset kubernetes.Interface,
	namespace, name, kind string,
	tailLines int64,
	logChan chan<- StreamLogMessage,
) {
	podList, err := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		select {
		case logChan <- StreamLogMessage{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    name,
			Level:     "ERROR",
			Message:   fmt.Sprintf("Failed to list pods for workload %s: %v", name, err),
			Kind:      kind,
		}:
		case <-ctx.Done():
		}
		return
	}

	var matchingPods []string
	cleanName := strings.ToLower(name)
	for _, p := range podList.Items {
		pName := strings.ToLower(p.Name)
		if strings.HasPrefix(pName, cleanName) || strings.Contains(pName, cleanName) {
			if p.Status.Phase == corev1.PodRunning || p.Status.Phase == corev1.PodPending {
				matchingPods = append(matchingPods, p.Name)
			}
		}
	}

	if len(matchingPods) == 0 {
		isDevMode := os.Getenv("ALLOW_ANONYMOUS_WS") == "true" || os.Getenv("ENVSCALE_DEV_MODE") == "true" || os.Getenv("NODE_ENV") != "production"
		if isDevMode {
			streamFallbackTelemetry(ctx, namespace, name, kind, logChan)
			return
		}

		select {
		case logChan <- StreamLogMessage{
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    name,
			Level:     "WARN",
			Message:   fmt.Sprintf("No active running pods found matching workload '%s'", name),
			Kind:      kind,
		}:
		case <-ctx.Done():
		}
		return
	}

	var podWg sync.WaitGroup
	for _, pName := range matchingPods {
		podWg.Add(1)
		go func(p string) {
			defer podWg.Done()
			streamPodLogs(ctx, clientset, namespace, p, tailLines, logChan)
		}(pName)
	}

	podWg.Wait()
}

func streamResourceEvents(
	ctx context.Context,
	clientset kubernetes.Interface,
	namespace, name, kind string,
	logChan chan<- StreamLogMessage,
) {
	events, err := clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, evt := range events.Items {
			if matchesResource(evt, name) {
				lvl := "INFO"
				if evt.Type == corev1.EventTypeWarning {
					lvl = "WARN"
				}
				select {
				case logChan <- StreamLogMessage{
					Timestamp: evt.LastTimestamp.Time.UTC().Format(time.RFC3339),
					Source:    fmt.Sprintf("%s/%s", evt.InvolvedObject.Kind, evt.InvolvedObject.Name),
					Level:     lvl,
					Message:   fmt.Sprintf("[EVENT] Reason: %s | Message: %s", evt.Reason, evt.Message),
					Kind:      kind,
				}:
				case <-ctx.Done():
					return
				}
			}
		}
	}

	watcher, err := clientset.CoreV1().Events(namespace).Watch(ctx, metav1.ListOptions{})
	if err != nil {
		return
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.ResultChan():
			if !ok {
				return
			}
			if evt, isEvt := event.Object.(*corev1.Event); isEvt && evt != nil {
				if matchesResource(*evt, name) {
					lvl := "INFO"
					if evt.Type == corev1.EventTypeWarning {
						lvl = "WARN"
					}
					select {
					case logChan <- StreamLogMessage{
						Timestamp: evt.LastTimestamp.Time.UTC().Format(time.RFC3339),
						Source:    fmt.Sprintf("%s/%s", evt.InvolvedObject.Kind, evt.InvolvedObject.Name),
						Level:     lvl,
						Message:   fmt.Sprintf("[EVENT] Reason: %s | Message: %s", evt.Reason, evt.Message),
						Kind:      kind,
					}:
					case <-ctx.Done():
						return
					}
				}
			}
		}
	}
}

func matchesResource(evt corev1.Event, name string) bool {
	cleanName := strings.ToLower(name)
	targetName := strings.ToLower(evt.InvolvedObject.Name)
	return strings.EqualFold(targetName, cleanName) || strings.Contains(targetName, cleanName)
}

func parseLogLine(raw string) (string, string, string) {
	parts := strings.SplitN(raw, " ", 2)
	ts := time.Now().UTC().Format(time.RFC3339)
	msg := raw

	if len(parts) == 2 {
		if _, err := time.Parse(time.RFC3339, parts[0]); err == nil || strings.Contains(parts[0], "T") {
			ts = parts[0]
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

	return ts, lvl, msg
}
