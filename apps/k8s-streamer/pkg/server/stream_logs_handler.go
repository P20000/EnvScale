package server

import (
	"context"
	"fmt"
	"net/http"
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

	outChan := make(chan interface{}, 2000)
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for msg := range outChan {
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

	rawNs := strings.TrimSpace(r.URL.Query().Get("namespace"))
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	tailLinesStr := r.URL.Query().Get("tailLines")

	var tailLines int64 = 100
	if tailLinesStr != "" {
		if parsed, err := strconv.ParseInt(tailLinesStr, 10, 64); err == nil && parsed > 0 {
			tailLines = parsed
		}
	}

	// Use stream clientset configured with Timeout=0 for persistent connections
	clientset, err := clusterManager.GetStreamClientset(clusterID)
	if err != nil {
		select {
		case outChan <- StreamDiagnosticMessage{
			Type:      "diagnostic",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Source:    "system",
			Status:    "failed",
			Reason:    fmt.Sprintf("Failed to get clientset for cluster %s: %v", clusterID, err),
		}:
		case <-ctx.Done():
		}
		close(outChan)
		wg.Wait()
		return
	}

	normalizedKind := strings.ToLower(kind)
	switch normalizedKind {
	case "service", "ingress", "node":
		targetNs := rawNs
		if targetNs == "" || strings.EqualFold(targetNs, "all") || strings.EqualFold(targetNs, "_all") {
			targetNs = "default"
		}
		streamResourceEvents(ctx, clientset, targetNs, name, kind, outChan)
	default:
		// Workload and pod log streaming with cluster-wide or namespace scope
		mgr := NewLogStreamManager(clientset, outChan)
		targets, err := mgr.DiscoverContainers(ctx, rawNs, name, kind)
		if err != nil {
			select {
			case outChan <- StreamDiagnosticMessage{
				Type:      "diagnostic",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Source:    "system",
				Namespace: rawNs,
				Status:    "failed",
				Reason:    err.Error(),
			}:
			case <-ctx.Done():
			}
		} else {
			scope := rawNs
			if scope == "" || strings.EqualFold(scope, "all") || strings.EqualFold(scope, "_all") {
				scope = "all"
			}
			mgr.StartStreams(ctx, targets, tailLines, scope)
		}
	}

	<-ctx.Done()
	close(outChan)
	wg.Wait()
}

func streamResourceEvents(
	ctx context.Context,
	clientset kubernetes.Interface,
	namespace, name, kind string,
	outChan chan<- interface{},
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
				case outChan <- StreamLogMessage{
					Type:      "log",
					Timestamp: evt.LastTimestamp.Time.UTC().Format(time.RFC3339),
					Namespace: namespace,
					Pod:       evt.InvolvedObject.Name,
					Container: evt.InvolvedObject.Kind,
					Source:    fmt.Sprintf("%s/%s/%s", namespace, evt.InvolvedObject.Kind, evt.InvolvedObject.Name),
					Level:     lvl,
					Message:   fmt.Sprintf("[EVENT] Reason: %s | Message: %s", evt.Reason, evt.Message),
					Stream:    "stdout",
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
					case outChan <- StreamLogMessage{
						Type:      "log",
						Timestamp: evt.LastTimestamp.Time.UTC().Format(time.RFC3339),
						Namespace: namespace,
						Pod:       evt.InvolvedObject.Name,
						Container: evt.InvolvedObject.Kind,
						Source:    fmt.Sprintf("%s/%s/%s", namespace, evt.InvolvedObject.Kind, evt.InvolvedObject.Name),
						Level:     lvl,
						Message:   fmt.Sprintf("[EVENT] Reason: %s | Message: %s", evt.Reason, evt.Message),
						Stream:    "stdout",
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
	if name == "" || strings.EqualFold(name, "all") || strings.EqualFold(name, "all-resources") {
		return true
	}
	cleanName := strings.ToLower(name)
	targetName := strings.ToLower(evt.InvolvedObject.Name)
	return strings.EqualFold(targetName, cleanName) || strings.Contains(targetName, cleanName)
}
