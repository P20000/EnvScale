package k8s

import (
	"context"
	"sync"
	"time"

	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// Generation returns the monotonic instance generation of this InformerManager.
func (im *InformerManager) Generation() uint64 {
	return im.generation
}

// IsStopped returns true once Stop has been called on this InformerManager.
func (im *InformerManager) IsStopped() bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.stopped
}

// LastSyncAt returns the timestamp of the most recent completed WaitForSynced pass.
func (im *InformerManager) LastSyncAt() time.Time {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.lastSyncAt
}

func (im *InformerManager) currentFactory() informers.SharedInformerFactory {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.factory
}

func (im *InformerManager) currentFactoryStopCh() <-chan struct{} {
	im.mu.RLock()
	defer im.mu.RUnlock()
	return im.factoryStopCh
}

// AllowedResources returns a defensive copy of the currently configured allowed resource map,
// or nil if all non-secret resources are permitted.
func (im *InformerManager) AllowedResources() map[string]bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	if im.allowedResources == nil {
		return nil
	}
	cp := make(map[string]bool, len(im.allowedResources))
	for k, v := range im.allowedResources {
		cp[k] = v
	}
	return cp
}

// SetMetricsAllowed configures whether metrics-server queries are permitted on this manager.
func (im *InformerManager) SetMetricsAllowed(allowed bool) {
	im.mu.Lock()
	defer im.mu.Unlock()
	v := allowed
	im.metricsAllowed = &v
}

// IsMetricsAllowed reports whether metrics-server polling/lookup is permitted.
func (im *InformerManager) IsMetricsAllowed() bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	if im.metricsAllowed == nil {
		return true
	}
	return *im.metricsAllowed
}

// SetAllowedResources configures the set of Kubernetes resource keys (e.g. "core/v1/pods")
// permitted for SharedInformer registration prior to Start/StartAsync.
func (im *InformerManager) SetAllowedResources(allowed map[string]bool) {
	im.mu.Lock()
	defer im.mu.Unlock()
	if allowed == nil {
		im.allowedResources = nil
		return
	}
	cp := make(map[string]bool, len(allowed))
	for k, v := range allowed {
		cp[k] = v
	}
	im.allowedResources = cp
}

// ReconcileAllowedResources dynamically updates permitted resources on a live InformerManager.
// When any previously active resource is revoked, the old SharedInformerFactory is stopped and
// replaced so watches terminate immediately and old informer stores are discarded (never retained).
// Purely additive grants register fresh informers on the active factory and start them.
func (im *InformerManager) ReconcileAllowedResources(allowed map[string]bool) []string {
	im.reconcileMu.Lock()
	defer im.reconcileMu.Unlock()

	im.mu.Lock()
	if im.stopped {
		im.mu.Unlock()
		return nil
	}

	var cp map[string]bool
	if allowed != nil {
		cp = make(map[string]bool, len(allowed))
		for k, v := range allowed {
			cp[k] = v
		}
	}

	if !im.started {
		im.allowedResources = cp
		im.mu.Unlock()
		return nil
	}

	hasRevocation := false
	if cp != nil {
		for k := range im.registeredResources {
			if !cp[k] {
				hasRevocation = true
				break
			}
		}
	}

	if hasRevocation {
		oldStopCh := im.factoryStopCh
		oldStopOnce := im.factoryStopOnce
		oldReadyCh := im.readyCh
		oldReadyOnce := im.readyOnce

		im.factory = informers.NewSharedInformerFactory(im.clientset, 30*time.Second)
		im.factoryStopCh = make(chan struct{})
		im.factoryStopOnce = &sync.Once{}
		newReadyCh := make(chan struct{})
		newReadyOnce := &sync.Once{}
		im.readyCh = newReadyCh
		im.readyOnce = newReadyOnce

		im.vsInformer = nil
		im.vscInformer = nil
		im.registeredResources = make(map[string]bool)
		im.activeResources = make(map[string]bool)
		im.syncedByKey = make(map[string]cache.InformerSynced)
		im.allowedResources = cp
		im.lastSyncAt = time.Time{}
		im.mu.Unlock()

		// Stop all watches/reflectors on the superseded factory so revoked resources are no longer watched.
		if oldStopOnce != nil && oldStopCh != nil {
			oldStopOnce.Do(func() { close(oldStopCh) })
		}
		if oldReadyOnce != nil && oldReadyCh != nil {
			oldReadyOnce.Do(func() { close(oldReadyCh) })
		}

		im.registerAllowedInformers()
		newReadyOnce.Do(func() { close(newReadyCh) })

		im.mu.RLock()
		activated := make([]string, 0, len(im.registeredResources))
		for k := range im.registeredResources {
			activated = append(activated, k)
		}
		f := im.factory
		fStopCh := im.factoryStopCh
		running := im.running && !im.stopped
		im.mu.RUnlock()

		if running && f != nil {
			f.Start(fStopCh)
		}
		return activated
	}

	// Purely additive / unchanged permissions: register only newly granted informers.
	im.allowedResources = cp
	if im.activeResources == nil {
		im.activeResources = make(map[string]bool)
	}
	for k := range im.registeredResources {
		im.activeResources[k] = true
	}
	before := make(map[string]bool, len(im.registeredResources))
	for k, v := range im.registeredResources {
		before[k] = v
	}
	im.mu.Unlock()

	im.registerAllowedInformers()

	im.mu.RLock()
	var activated []string
	for k := range im.registeredResources {
		if !before[k] {
			activated = append(activated, k)
		}
	}
	f := im.factory
	fStopCh := im.factoryStopCh
	running := im.running && !im.stopped
	im.mu.RUnlock()

	if len(activated) > 0 && running && f != nil {
		f.Start(fStopCh)
	}
	return activated
}

// shouldRegisterInformer returns true only if resourceKey is allowed and not yet registered.
func (im *InformerManager) shouldRegisterInformer(resourceKey string) bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	if im.registeredResources[resourceKey] {
		return false
	}
	if im.allowedResources == nil {
		return true
	}
	return im.allowedResources[resourceKey]
}

// isResourceRegistered returns true if an informer for resourceKey is registered and currently active.
func (im *InformerManager) isResourceRegistered(resourceKey string) bool {
	im.mu.RLock()
	defer im.mu.RUnlock()
	if !im.started && !im.stopped && len(im.registeredResources) == 0 {
		// Allows unit tests calling snapshot getters on unstarted NewInformerManagerWithClientset to keep working.
		return im.allowedResources == nil || im.allowedResources[resourceKey]
	}
	return im.registeredResources[resourceKey] && im.activeResources[resourceKey]
}

// recordInformer records a started informer so cache sync waits only on active permitted resources.
func (im *InformerManager) recordInformer(resourceKey string, inf cache.SharedIndexInformer) {
	if inf == nil {
		return
	}
	im.mu.Lock()
	defer im.mu.Unlock()
	if im.registeredResources == nil {
		im.registeredResources = make(map[string]bool)
	}
	if im.activeResources == nil {
		im.activeResources = make(map[string]bool)
	}
	if im.syncedByKey == nil {
		im.syncedByKey = make(map[string]cache.InformerSynced)
	}
	im.registeredResources[resourceKey] = true
	im.activeResources[resourceKey] = im.allowedResources == nil || im.allowedResources[resourceKey]
	im.syncedByKey[resourceKey] = inf.HasSynced
}

// WaitForSynced waits for only active permitted informers to finish initial sync,
// returning early on ctx cancellation, InformerManager stop, or factory rotation.
func (im *InformerManager) WaitForSynced(ctx context.Context) bool {
	im.mu.RLock()
	started := im.started
	readyCh := im.readyCh
	stopCh := im.stopCh
	fStopCh := im.factoryStopCh
	im.mu.RUnlock()

	if started && readyCh != nil {
		select {
		case <-readyCh:
		case <-stopCh:
			return false
		case <-fStopCh:
			return false
		case <-ctx.Done():
			return false
		}
	}

	im.mu.RLock()
	if im.stopped {
		im.mu.RUnlock()
		return false
	}
	fStopCh = im.factoryStopCh
	funcs := make([]cache.InformerSynced, 0, len(im.syncedByKey))
	for k, fn := range im.syncedByKey {
		if im.activeResources[k] && fn != nil {
			funcs = append(funcs, fn)
		}
	}
	im.mu.RUnlock()

	if len(funcs) == 0 {
		// No informers were permitted/started; leave im.lastSyncAt explicitly zero/unknown.
		return true
	}

	waitStop := make(chan struct{})
	done := make(chan struct{})
	defer close(done)

	go func() {
		select {
		case <-ctx.Done():
			close(waitStop)
		case <-stopCh:
			close(waitStop)
		case <-fStopCh:
			close(waitStop)
		case <-done:
		}
	}()

	synced := cache.WaitForCacheSync(waitStop, funcs...)
	if synced {
		im.mu.Lock()
		if !im.stopped {
			im.lastSyncAt = time.Now().UTC()
		}
		im.mu.Unlock()
	}
	return synced
}

// HasMetricsClient reports whether a metrics.k8s.io clientset was initialized.
func (im *InformerManager) HasMetricsClient() bool {
	return im.metricsClient != nil
}

// WatchSecrets reports whether Secret informer watches are explicitly enabled on this manager.
func (im *InformerManager) WatchSecrets() bool {
	return im.watchSecrets
}
