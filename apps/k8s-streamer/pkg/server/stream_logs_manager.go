package server

import (
	"context"

	"k8s.io/client-go/kubernetes"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

// ContainerTarget re-exports k8s.ContainerTarget for existing server test compatibility.
type ContainerTarget = k8s.ContainerTarget

// LogStreamManager wraps k8s.LogEngine for backward compatibility with existing unit tests.
type LogStreamManager struct {
	engine *k8s.LogEngine
}

// NewLogStreamManager constructs a thin LogStreamManager delegating to k8s.LogEngine.
func NewLogStreamManager(clientset kubernetes.Interface, _ chan<- interface{}) *LogStreamManager {
	return &LogStreamManager{
		engine: k8s.NewLogEngine(clientset, "", "legacy", "", nil),
	}
}

// DiscoverContainers delegates pod/container discovery to k8s.LogEngine.
func (m *LogStreamManager) DiscoverContainers(ctx context.Context, namespace, name, kind string) ([]ContainerTarget, error) {
	return m.engine.DiscoverContainers(ctx, namespace, name, kind, "")
}
