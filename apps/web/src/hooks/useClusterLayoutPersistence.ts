import { useCallback, useEffect, useRef } from "react";
import type { OnNodeDrag } from "@xyflow/react";
import { useAuthStore } from "../store/useAuthStore";
import { useTopologyStore } from "../store/useTopologyStore";
import {
  loadLocalLayout,
  saveLocalLayout,
  clearLocalLayout,
} from "../store/helpers/layoutStorage";
import {
  apiGetClusterLayout,
  apiSaveClusterLayout,
  apiResetClusterLayout,
} from "../config/api";

interface UseClusterLayoutPersistenceOptions {
  onLayoutReset?: () => void;
}

export function useClusterLayoutPersistence(options?: UseClusterLayoutPersistenceOptions) {
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const userNodePositions = useTopologyStore((s) => s.userNodePositions);
  const setUserNodePositions = useTopologyStore((s) => s.setUserNodePositions);
  const clearUserNodePositions = useTopologyStore((s) => s.clearUserNodePositions);
  const applyDagreLayout = useTopologyStore((s) => s.applyDagreLayout);

  const user = useAuthStore((s) => s.user);
  const userId = user?.id || user?.email || null;

  const saveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedClusterRef = useRef<string | null>(null);

  // 1. Initial hydration on activeCluster or user change
  useEffect(() => {
    if (!activeCluster) return;

    // A. Zero-latency local scoped cache load
    const cachedPositions = loadLocalLayout(userId, activeCluster);
    const hasLocal = Object.keys(cachedPositions).length > 0;
    if (hasLocal) {
      setUserNodePositions(cachedPositions);
      applyDagreLayout();
    }

    // B. Asynchronous background fetch from database to sync remote changes
    let isCancelled = false;

    apiGetClusterLayout(activeCluster)
      .then((remotePositions) => {
        if (isCancelled) return;
        if (remotePositions && Object.keys(remotePositions).length > 0) {
          setUserNodePositions(remotePositions);
          saveLocalLayout(userId, activeCluster, remotePositions);
          applyDagreLayout();
        } else if (!hasLocal) {
          // Neither remote nor local has custom positions - autolayout is clean
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn("Could not sync remote cluster layout:", err);
        }
      });

    lastLoadedClusterRef.current = activeCluster;

    return () => {
      isCancelled = true;
      if (saveDebounceTimerRef.current) {
        clearTimeout(saveDebounceTimerRef.current);
      }
    };
  }, [activeCluster, userId, setUserNodePositions, applyDagreLayout]);

  // 2. Drag-stop handler: update store, write local cache immediately, debounce remote save
  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, node, draggedNodes) => {
      const targets = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node];
      const updates: Record<string, { x: number; y: number }> = {};
      targets.forEach((n) => {
        if (n && n.id && n.position) {
          updates[n.id] = {
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
          };
        }
      });

      const currentPositions = useTopologyStore.getState().userNodePositions || {};
      const mergedPositions = { ...currentPositions, ...updates };

      // Update Zustand in-memory state
      setUserNodePositions(updates);
      // Recompute layout for dynamic edge handles
      applyDagreLayout();

      // Zero-latency local storage persist
      saveLocalLayout(userId, activeCluster, mergedPositions);

      // Debounce remote database persistence (600ms)
      if (activeCluster) {
        if (saveDebounceTimerRef.current) {
          clearTimeout(saveDebounceTimerRef.current);
        }
        saveDebounceTimerRef.current = setTimeout(() => {
          apiSaveClusterLayout(activeCluster, mergedPositions).catch((err) => {
            console.warn("Failed to persist cluster layout to database:", err);
          });
        }, 600);
      }
    },
    [userId, activeCluster, setUserNodePositions, applyDagreLayout]
  );

  // 3. Auto Layout reset: clear store, clear local cache, delete from remote DB
  const handleAutoLayoutReset = useCallback(() => {
    if (saveDebounceTimerRef.current) {
      clearTimeout(saveDebounceTimerRef.current);
    }

    clearUserNodePositions();
    clearLocalLayout(userId, activeCluster);

    if (activeCluster) {
      apiResetClusterLayout(activeCluster).catch((err) => {
        console.warn("Failed to reset cluster layout on backend:", err);
      });
    }

    applyDagreLayout(undefined, { resetUserPositions: true });
    options?.onLayoutReset?.();
  }, [userId, activeCluster, clearUserNodePositions, applyDagreLayout, options]);

  const hasCustomPositions = Object.keys(userNodePositions || {}).length > 0;

  return {
    handleNodeDragStop,
    handleAutoLayoutReset,
    hasCustomPositions,
  };
}
