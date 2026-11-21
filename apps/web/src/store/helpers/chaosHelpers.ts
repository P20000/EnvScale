import type { ChaosFaultEvent } from "../types/topologyTypes";

export type ActiveChaosFaultsMap = Record<string, ChaosFaultEvent>;

/**
 * Updates the active faults map upon receiving a WebSocket chaos event.
 */
export function handleChaosWsEvent(
  currentFaults: ActiveChaosFaultsMap,
  payload: Record<string, unknown>,
  isCleared: boolean
): ActiveChaosFaultsMap {
  const faultId = String(payload.faultId || payload.id || "");
  if (!faultId) return currentFaults;

  const next = { ...currentFaults };
  if (isCleared || payload.status === "cleared") {
    delete next[faultId];
    return next;
  }

  const fault: ChaosFaultEvent = {
    faultId,
    faultType: String(payload.faultType || "crash"),
    target: String(payload.target || "pod"),
    name: String(payload.name || ""),
    namespace: String(payload.namespace || "default"),
    clusterId: String(payload.clusterId || ""),
    status: String(payload.status || "injected"),
    message: payload.message ? String(payload.message) : undefined,
    timestamp: String(payload.timestamp || new Date().toISOString()),
  };

  next[faultId] = fault;
  return next;
}

/**
 * Checks if a workload (or any of its pods) has an ongoing chaos fault.
 */
export function getActiveWorkloadFault(
  activeFaults: ActiveChaosFaultsMap | undefined,
  workloadName: string,
  podNames: string[] = []
): ChaosFaultEvent | undefined {
  if (!activeFaults) return undefined;
  for (const fault of Object.values(activeFaults)) {
    if (fault.name === workloadName || podNames.includes(fault.name)) {
      return fault;
    }
  }
  return undefined;
}

/**
 * Checks if a specific pod has an ongoing chaos fault.
 */
export function getActivePodFault(
  activeFaults: ActiveChaosFaultsMap | undefined,
  podName: string
): ChaosFaultEvent | undefined {
  if (!activeFaults) return undefined;
  for (const fault of Object.values(activeFaults)) {
    if (fault.name === podName) {
      return fault;
    }
  }
  return undefined;
}
