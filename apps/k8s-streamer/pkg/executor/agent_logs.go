package executor

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
)

type agentStreamHandle struct {
	streamID  string
	done      <-chan struct{}
	stopFn    func(reason string) error
	closeOnce sync.Once
}

func (h *agentStreamHandle) StreamID() string {
	return h.streamID
}

func (h *agentStreamHandle) Close() error {
	var err error
	h.closeOnce.Do(func() {
		if h.stopFn != nil {
			err = h.stopFn("client_closed")
		}
	})
	return err
}

func (h *agentStreamHandle) Done() <-chan struct{} {
	return h.done
}

// StartLogStream initiates a multiplexed bidirectional log stream with the active v2.0 Agent session.
func (a *AgentExecutor) StartLogStream(ctx context.Context, req LogStreamRequest, sink chan<- LogFrame) (StreamHandle, error) {
	if a.registry == nil || a.registry.SessionHub() == nil {
		return nil, fmt.Errorf("%w: agent registry unavailable", ErrClusterNotFound)
	}

	meta, exists := a.registry.GetStateMeta(a.clusterID)
	if !exists {
		return nil, fmt.Errorf("%w: agent cluster %s is not registered", ErrClusterNotFound, a.clusterID)
	}
	if !meta.Connected {
		return nil, fmt.Errorf("%w: agent for cluster %s is disconnected", ErrClusterDisconnected, a.clusterID)
	}
	if meta.ProtocolVersion != "2.0" {
		return nil, fmt.Errorf("%w: agent for cluster %s runs protocol v%s; upgrade to Agent Protocol v2.0 for log streaming",
			ErrCapabilityUnsupported, a.clusterID, meta.ProtocolVersion)
	}
	if rep, has := meta.ReportedCapabilities[CapLogs]; has && rep.State == string(CapPermissionDenied) {
		reason := rep.Reason
		if reason == "" {
			reason = "agent lacks Kubernetes pods/log permission"
		}
		return nil, fmt.Errorf("%w: %s", ErrPermissionDenied, reason)
	}
	if sink == nil {
		return nil, fmt.Errorf("%w: output sink channel is required", ErrInvalidLogRequest)
	}

	norm, err := ValidateAndNormalizeLogRequest(req)
	if err != nil {
		return nil, err
	}

	payload := types.LogStreamStartPayload{
		StreamID:     norm.StreamID,
		ClusterID:    a.clusterID,
		Namespace:    norm.Namespace,
		Kind:         norm.Kind,
		Name:         norm.Name,
		Container:    norm.Container,
		TailLines:    norm.TailLines,
		Follow:       norm.Follow,
		Previous:     norm.Previous,
		Timestamps:   norm.Timestamps,
		SinceSeconds: norm.SinceSeconds,
		SinceTime:    norm.SinceTime,
	}

	_, done, stopFn, openErr := a.registry.SessionHub().OpenLogStream(a.clusterID, payload, sink)
	if openErr != nil {
		if errors.Is(openErr, k8s.ErrAgentSessionUnavailable) {
			return nil, fmt.Errorf("%w: %v", ErrClusterDisconnected, openErr)
		}
		return nil, openErr
	}

	if ctx != nil {
		go func() {
			select {
			case <-ctx.Done():
				_ = stopFn("context_canceled")
			case <-done:
			}
		}()
	}

	return &agentStreamHandle{
		streamID: norm.StreamID,
		done:     done,
		stopFn:   stopFn,
	}, nil
}
