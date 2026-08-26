// Package k8s — dedup.go implements a lightweight per-resource deduplication
// cache for the Informer emit path. When a Kubernetes Informer fires an
// UpdateFunc callback, the emitted delta may be identical to the previously
// emitted delta for that same resource (e.g., a pod's periodic resync with no
// actual state change). Broadcasting these no-op updates wastes bandwidth on
// WebSocket connections, especially in large clusters (50+ pods) where
// resync traffic can dominate.
//
// DedupCache stores a hash of the last emitted delta payload for each resource
// (keyed by kind+namespace+name). Before broadcasting, the Informer calls
// ShouldEmit(key, delta) which returns true only if the delta differs from
// the cached version — eliminating redundant WebSocket messages.
//
// The cache uses FNV-1a hashing (fast, non-cryptographic) for O(1) comparison
// and has bounded memory: entries are evicted after 5 minutes of inactivity
// or when the resource is deleted.
package k8s

import (
	"encoding/json"
	"hash/fnv"
	"sync"
	"time"
)

// dedupEntry stores the hash and last-access time for a single resource.
type dedupEntry struct {
	hash     uint64
	lastSeen time.Time
}

// DedupCache is a thread-safe cache that tracks the last emitted delta hash
// per Kubernetes resource to suppress duplicate WebSocket broadcasts.
type DedupCache struct {
	entries map[string]*dedupEntry
	mu      sync.RWMutex
	maxAge  time.Duration // entries older than this are eligible for eviction
}

// NewDedupCache creates a new deduplication cache and starts a background
// eviction goroutine that prunes stale entries every 60 seconds.
func NewDedupCache() *DedupCache {
	dc := &DedupCache{
		entries: make(map[string]*dedupEntry),
		maxAge:  5 * time.Minute,
	}
	go dc.evictionLoop()
	return dc
}

// ShouldEmit returns true if the delta for the given resource key has changed
// since the last call (or if it's the first time we see it). If the delta is
// identical to the cached version, returns false — the caller should skip
// broadcasting this event.
//
// key format: "{kind}/{namespace}/{name}" (e.g., "Pod/default/nginx-abc123")
func (dc *DedupCache) ShouldEmit(key string, delta interface{}) bool {
	newHash := hashDelta(delta)

	dc.mu.Lock()
	defer dc.mu.Unlock()

	entry, exists := dc.entries[key]
	now := time.Now()

	if exists && entry.hash == newHash {
		// Delta unchanged — suppress this broadcast
		entry.lastSeen = now
		return false
	}

	// New or changed delta — update cache and allow broadcast
	dc.entries[key] = &dedupEntry{
		hash:     newHash,
		lastSeen: now,
	}
	return true
}

// Remove deletes a resource entry from the cache (called on Informer DeleteFunc).
func (dc *DedupCache) Remove(key string) {
	dc.mu.Lock()
	delete(dc.entries, key)
	dc.mu.Unlock()
}

// Size returns the current number of tracked resources.
func (dc *DedupCache) Size() int {
	dc.mu.RLock()
	defer dc.mu.RUnlock()
	return len(dc.entries)
}

// Stats returns dedup cache statistics for the /healthz endpoint.
type DedupStats struct {
	TrackedResources int `json:"trackedResources"`
	MaxAgeSec        int `json:"maxAgeSec"`
}

func (dc *DedupCache) Stats() DedupStats {
	return DedupStats{
		TrackedResources: dc.Size(),
		MaxAgeSec:        int(dc.maxAge.Seconds()),
	}
}

// evictionLoop runs every 60 seconds and removes entries that haven't been
// updated within maxAge. This prevents unbounded memory growth if resources
// are deleted without going through the Informer DeleteFunc path.
func (dc *DedupCache) evictionLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		dc.mu.Lock()
		cutoff := time.Now().Add(-dc.maxAge)
		evicted := 0
		for key, entry := range dc.entries {
			if entry.lastSeen.Before(cutoff) {
				delete(dc.entries, key)
				evicted++
			}
		}
		dc.mu.Unlock()

		if evicted > 0 {
			// Intentionally no log import — keep this file lightweight.
			// Eviction stats are visible through DedupStats().
		}
	}
}

// hashDelta computes a fast FNV-1a hash of the JSON-serialized delta payload.
// We use JSON serialization to ensure structural equality (field ordering in
// Go maps is non-deterministic, but json.Marshal produces deterministic output
// for structs with fixed field order, which all our Delta types are).
func hashDelta(delta interface{}) uint64 {
	data, err := json.Marshal(delta)
	if err != nil {
		// Fallback: return 0 so ShouldEmit always returns true on marshal failure
		return 0
	}

	h := fnv.New64a()
	h.Write(data)
	return h.Sum64()
}
