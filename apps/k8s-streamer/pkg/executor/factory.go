package executor

import (
	"context"
	"fmt"
	"sync"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

// ClusterExecutorFactory resolves a unified ClusterExecutor strictly by canonical clusterID.
// Zero single-cluster (len == 1) or dev-alias fallbacks are permitted.
type ClusterExecutorFactory struct {
	clusterManager *k8s.ClusterManager
	capsRegistry   *ClusterCapabilityRegistry
	mu             sync.Mutex
	directCache    map[string]*DirectExecutor
}

// NewClusterExecutorFactory constructs a ClusterExecutorFactory backed by ClusterManager.
func NewClusterExecutorFactory(clusterManager *k8s.ClusterManager) *ClusterExecutorFactory {
	return &ClusterExecutorFactory{
		clusterManager: clusterManager,
		capsRegistry:   NewClusterCapabilityRegistry(),
		directCache:    make(map[string]*DirectExecutor),
	}
}

// CapabilitiesRegistry returns the factory's ClusterCapabilityRegistry.
func (f *ClusterExecutorFactory) CapabilitiesRegistry() *ClusterCapabilityRegistry {
	return f.capsRegistry
}

// GetExecutor selects DirectExecutor or AgentExecutor strictly by exact canonical clusterID.
func (f *ClusterExecutorFactory) GetExecutor(clusterID string) (ClusterExecutor, error) {
	if clusterID == "" {
		return nil, fmt.Errorf("%w: clusterId is required", ErrClusterNotFound)
	}
	if f.clusterManager == nil {
		return nil, fmt.Errorf("%w: cluster manager unavailable", ErrClusterNotFound)
	}

	if im, ok := f.clusterManager.GetCluster(clusterID); ok && im != nil {
		f.mu.Lock()
		if cached, exists := f.directCache[clusterID]; exists && cached.im == im && !cached.invalidated.Load() {
			f.mu.Unlock()
			return cached, nil
		}
		var stale *DirectExecutor
		if prev, exists := f.directCache[clusterID]; exists {
			stale = prev
		}
		exec := NewDirectExecutor(clusterID, im, f.capsRegistry)
		f.directCache[clusterID] = exec
		f.mu.Unlock()

		if stale != nil {
			_ = stale.Close()
		}
		return exec, nil
	}

	if reg := f.clusterManager.AgentRegistry(); reg != nil && reg.HasCluster(clusterID) {
		return NewAgentExecutor(clusterID, reg, f.capsRegistry), nil
	}

	return nil, fmt.Errorf("%w: cluster %q is not registered", ErrClusterNotFound, clusterID)
}

// GetSnapshot resolves the executor for clusterID and retrieves a normalized SnapshotResponse.
func (f *ClusterExecutorFactory) GetSnapshot(ctx context.Context, clusterID string) (*SnapshotResponse, error) {
	exec, err := f.GetExecutor(clusterID)
	if err != nil {
		return nil, err
	}
	return exec.GetSnapshot(ctx)
}

// Capabilities resolves the executor for clusterID and reports its ClusterCapabilities.
func (f *ClusterExecutorFactory) Capabilities(ctx context.Context, clusterID string) (ClusterCapabilities, error) {
	return f.CapabilitiesWithRefresh(ctx, clusterID, false)
}

// CapabilitiesWithRefresh returns ClusterCapabilities, bypassing cache and reconciling live informers when forceRefresh is true.
func (f *ClusterExecutorFactory) CapabilitiesWithRefresh(ctx context.Context, clusterID string, forceRefresh bool) (ClusterCapabilities, error) {
	exec, err := f.GetExecutor(clusterID)
	if err != nil {
		return ClusterCapabilities{}, err
	}
	if forceRefresh {
		if de, ok := exec.(*DirectExecutor); ok {
			return de.RefreshCapabilities(ctx), nil
		}
	}
	return exec.Capabilities(ctx), nil
}

// Evict removes cached executor and capability state and invalidates any in-flight executor generation.
func (f *ClusterExecutorFactory) Evict(clusterID string) {
	f.mu.Lock()
	stale := f.directCache[clusterID]
	delete(f.directCache, clusterID)
	f.mu.Unlock()

	if stale != nil {
		_ = stale.Close()
	}
	if f.capsRegistry != nil {
		f.capsRegistry.Delete(clusterID)
	}
}

// EvictAll clears and invalidates all cached executors and capabilities (used on unregister-all).
func (f *ClusterExecutorFactory) EvictAll() {
	f.mu.Lock()
	old := f.directCache
	f.directCache = make(map[string]*DirectExecutor)
	f.mu.Unlock()

	for _, stale := range old {
		if stale != nil {
			_ = stale.Close()
		}
	}
	if f.capsRegistry != nil {
		f.capsRegistry.Clear()
	}
}
