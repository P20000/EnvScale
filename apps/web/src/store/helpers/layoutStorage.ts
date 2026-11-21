/**
 * Layout Storage Helper for Scoped Canvas Node Positions
 * Provides isolated local cache scoped per cluster and user so dragged layouts
 * survive browser reloads, navigation, and logouts without colliding between workspaces or users.
 */

export function getLayoutStorageKey(userId?: string | null, clusterId?: string | null): string {
  const effectiveUser = userId && userId.trim() ? userId.trim() : "anonymous";
  const effectiveCluster = clusterId && clusterId.trim() ? clusterId.trim() : "default";
  return `envscale-layout-user-${effectiveUser}-${effectiveCluster}`;
}

export function loadLocalLayout(
  userId?: string | null,
  clusterId?: string | null
): Record<string, { x: number; y: number }> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const key = getLayoutStorageKey(userId, clusterId);
    const raw = localStorage.getItem(key);
    if (!raw) {
      // Fallback: check cluster-only legacy key if user-specific key not yet set
      if (clusterId) {
        const clusterFallback = localStorage.getItem(`envscale-layout-cluster-${clusterId}`);
        if (clusterFallback) {
          const parsedFallback = JSON.parse(clusterFallback);
          if (parsedFallback && typeof parsedFallback === "object") {
            return parsedFallback as Record<string, { x: number; y: number }>;
          }
        }
      }
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, { x: number; y: number }>;
    }
  } catch (err) {
    console.warn("Failed to load local layout from cache:", err);
  }
  return {};
}

export function saveLocalLayout(
  userId: string | null | undefined,
  clusterId: string | null | undefined,
  positions: Record<string, { x: number; y: number }>
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const key = getLayoutStorageKey(userId, clusterId);
    localStorage.setItem(key, JSON.stringify(positions));
  } catch (err) {
    console.warn("Failed to save local layout to cache:", err);
  }
}

export function clearLocalLayout(
  userId?: string | null,
  clusterId?: string | null
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const key = getLayoutStorageKey(userId, clusterId);
    localStorage.removeItem(key);
    if (clusterId) {
      localStorage.removeItem(`envscale-layout-cluster-${clusterId}`);
    }
  } catch (err) {
    console.warn("Failed to clear local layout cache:", err);
  }
}
