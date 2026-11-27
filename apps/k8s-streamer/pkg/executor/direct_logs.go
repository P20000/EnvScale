package executor

import (
	"context"
	"fmt"
	"sync"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
)

type directStreamHandle struct {
	streamID  string
	cancel    context.CancelFunc
	done      chan struct{}
	closeOnce sync.Once
}

func (h *directStreamHandle) StreamID() string {
	return h.streamID
}

func (h *directStreamHandle) Close() error {
	h.closeOnce.Do(func() {
		if h.cancel != nil {
			h.cancel()
		}
	})
	return nil
}

func (h *directStreamHandle) Done() <-chan struct{} {
	return h.done
}

// StartLogStream starts non-buffering Kubernetes Pod/workload log streaming over Direct mode.
func (d *DirectExecutor) StartLogStream(ctx context.Context, req LogStreamRequest, sink chan<- LogFrame) (StreamHandle, error) {
	if sink == nil {
		return nil, fmt.Errorf("%w: output sink channel is required", ErrInvalidLogRequest)
	}
	if d.invalidated.Load() || d.im == nil || !d.im.IsRunning() {
		return nil, fmt.Errorf("%w: direct informer manager for cluster %s is not running", ErrClusterDisconnected, d.clusterID)
	}

	norm, err := ValidateAndNormalizeLogRequest(req)
	if err != nil {
		return nil, err
	}

	clientset := d.im.StreamClientset()
	if clientset == nil {
		clientset = d.im.Clientset()
	}
	if clientset == nil {
		return nil, fmt.Errorf("%w: streaming clientset unavailable for cluster %s", ErrClusterDisconnected, d.clusterID)
	}

	baseCtx := ctx
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	streamCtx, cancel := context.WithCancel(baseCtx)
	if d.closeCtx != nil {
		go func() {
			select {
			case <-d.closeCtx.Done():
				cancel()
			case <-streamCtx.Done():
			}
		}()
	}

	done := make(chan struct{})
	handle := &directStreamHandle{
		streamID: norm.StreamID,
		cancel:   cancel,
		done:     done,
	}

	payload := types.LogStreamStartPayload{
		StreamID:     norm.StreamID,
		ClusterID:    d.clusterID,
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

	engine := k8s.NewLogEngine(clientset, d.clusterID, norm.StreamID, "", sink)
	go func() {
		defer close(done)
		defer cancel()
		_ = engine.Run(streamCtx, payload)
	}()

	return handle, nil
}

