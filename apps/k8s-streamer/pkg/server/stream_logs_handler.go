package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"

	"github.com/EnvScale/k8s-streamer/pkg/executor"
	envws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

var logUpgrader = websocket.Upgrader{
	CheckOrigin: envws.IsOriginAllowed,
}

// HandleUniversalLogStream authenticates, authorizes, validates inputs, and streams unified
// Direct or Agent logs over WebSocket via ClusterExecutorFactory.
func HandleUniversalLogStream(
	executorFactory *executor.ClusterExecutorFactory,
	w http.ResponseWriter,
	r *http.Request,
) {
	claims, err := envws.AuthenticateHandshake(r)
	if err != nil {
		http.Error(w, fmt.Sprintf("Unauthorized: %v", err), http.StatusUnauthorized)
		return
	}

	clusterID := strings.TrimSpace(r.URL.Query().Get("clusterId"))
	if clusterID == "" {
		http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
		return
	}

	if err := envws.CheckClusterAuthorization(claims, clusterID); err != nil {
		http.Error(w, fmt.Sprintf("Forbidden: %v", err), http.StatusForbidden)
		return
	}

	req, err := parseLogStreamRequestFromQuery(clusterID, r)
	if err != nil {
		http.Error(w, fmt.Sprintf("Bad Request: %v", err), http.StatusBadRequest)
		return
	}

	if executorFactory == nil {
		http.Error(w, "executor factory unavailable", http.StatusServiceUnavailable)
		return
	}

	exec, err := executorFactory.GetExecutor(clusterID)
	if err != nil {
		if errors.Is(err, executor.ErrClusterNotFound) {
			http.Error(w, fmt.Sprintf("Cluster not found: %s", clusterID), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
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

	sink := make(chan executor.LogFrame, 256)
	handle, startErr := exec.StartLogStream(ctx, req, sink)
	if startErr != nil {
		code, status := classifyStartLogError(startErr)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_ = conn.WriteJSON(executor.LogFrame{
			Type:      "diagnostic",
			StreamID:  req.StreamID,
			ClusterID: clusterID,
			Timestamp: now,
			Source:    "system",
			Namespace: req.Namespace,
			Pod:       req.Name,
			Container: req.Container,
			Status:    status,
			Code:      code,
			Reason:    startErr.Error(),
		})
		_ = conn.WriteJSON(executor.LogFrame{
			Type:      "error",
			StreamID:  req.StreamID,
			ClusterID: clusterID,
			Timestamp: now,
			Source:    "system",
			Namespace: req.Namespace,
			Pod:       req.Name,
			Container: req.Container,
			Status:    status,
			Code:      code,
			Reason:    startErr.Error(),
		})
		return
	}
	defer func() {
		_ = handle.Close()
	}()

	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			_, msg, rErr := conn.ReadMessage()
			if rErr != nil {
				cancel()
				_ = handle.Close()
				return
			}
			var ctrl struct {
				Type   string `json:"type"`
				Action string `json:"action"`
			}
			if json.Unmarshal(msg, &ctrl) == nil {
				if strings.EqualFold(ctrl.Type, "cancel") || strings.EqualFold(ctrl.Action, "stop") {
					cancel()
					_ = handle.Close()
					return
				}
			}
		}
	}()

	streamDone := handle.Done()
	writeLoop := func() {
		for {
			select {
			case frame := <-sink:
				_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if wErr := conn.WriteJSON(frame); wErr != nil {
					cancel()
					_ = handle.Close()
					return
				}
			case <-streamDone:
				for {
					select {
					case frame := <-sink:
						_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
						if wErr := conn.WriteJSON(frame); wErr != nil {
							return
						}
					default:
						return
					}
				}
			case <-ctx.Done():
				return
			}
		}
	}
	writeLoop()

	_ = handle.Close()
	_ = conn.Close()
	<-readDone
}

func parseLogStreamRequestFromQuery(clusterID string, r *http.Request) (executor.LogStreamRequest, error) {
	q := r.URL.Query()
	rawNs := strings.TrimSpace(q.Get("namespace"))
	kind := strings.TrimSpace(q.Get("kind"))
	name := strings.TrimSpace(q.Get("name"))
	container := strings.TrimSpace(q.Get("container"))

	var tailLines int64 = 100
	if rawTail := strings.TrimSpace(q.Get("tailLines")); rawTail != "" {
		parsed, err := strconv.ParseInt(rawTail, 10, 64)
		if err != nil || parsed < 0 {
			return executor.LogStreamRequest{}, fmt.Errorf("invalid tailLines parameter")
		}
		tailLines = parsed
	}

	follow := true
	if rawFollow := strings.TrimSpace(q.Get("follow")); rawFollow != "" {
		parsed, err := strconv.ParseBool(rawFollow)
		if err != nil {
			return executor.LogStreamRequest{}, fmt.Errorf("invalid follow parameter")
		}
		follow = parsed
	}

	previous := false
	if rawPrev := strings.TrimSpace(q.Get("previous")); rawPrev != "" {
		parsed, err := strconv.ParseBool(rawPrev)
		if err != nil {
			return executor.LogStreamRequest{}, fmt.Errorf("invalid previous parameter")
		}
		previous = parsed
	}

	timestamps := true
	if rawTS := strings.TrimSpace(q.Get("timestamps")); rawTS != "" {
		parsed, err := strconv.ParseBool(rawTS)
		if err != nil {
			return executor.LogStreamRequest{}, fmt.Errorf("invalid timestamps parameter")
		}
		timestamps = parsed
	}

	var sinceSeconds *int64
	if rawSinceSec := strings.TrimSpace(q.Get("sinceSeconds")); rawSinceSec != "" {
		parsed, err := strconv.ParseInt(rawSinceSec, 10, 64)
		if err != nil || parsed <= 0 {
			return executor.LogStreamRequest{}, fmt.Errorf("invalid sinceSeconds parameter")
		}
		sinceSeconds = &parsed
	}

	var sinceTime *time.Time
	if rawSinceTime := strings.TrimSpace(q.Get("sinceTime")); rawSinceTime != "" {
		parsed, err := time.Parse(time.RFC3339Nano, rawSinceTime)
		if err != nil {
			parsed, err = time.Parse(time.RFC3339, rawSinceTime)
		}
		if err != nil {
			return executor.LogStreamRequest{}, fmt.Errorf("invalid sinceTime parameter (RFC3339 expected)")
		}
		utc := parsed.UTC()
		sinceTime = &utc
	}

	return executor.ValidateAndNormalizeLogRequest(executor.LogStreamRequest{
		ClusterID:    clusterID,
		Namespace:    rawNs,
		Kind:         kind,
		Name:         name,
		Container:    container,
		TailLines:    tailLines,
		Follow:       follow,
		Previous:     previous,
		Timestamps:   timestamps,
		SinceSeconds: sinceSeconds,
		SinceTime:    sinceTime,
	})
}

func classifyStartLogError(err error) (code, status string) {
	switch {
	case errors.Is(err, executor.ErrCapabilityUnsupported):
		return "capability_unsupported", "unsupported"
	case errors.Is(err, executor.ErrClusterDisconnected), errors.Is(err, executor.ErrClusterUnreachable):
		return "cluster_disconnected", "disconnected"
	case errors.Is(err, executor.ErrPermissionDenied):
		return "permission_denied", "permission_denied"
	case errors.Is(err, executor.ErrResourceNotFound):
		return "not_found", "failed"
	case errors.Is(err, executor.ErrInvalidLogRequest):
		return "invalid_request", "failed"
	default:
		return "stream_error", "failed"
	}
}
