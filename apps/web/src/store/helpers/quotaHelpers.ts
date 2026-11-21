import type { K8sResourceQuotaData, K8sLimitRangeData } from "../types/topologyTypes";
import type { TopologyState } from "../useTopologyStore";

/**
 * Reducer for ResourceQuota and LimitRange WebSocket events
 */
export function handleQuotaWsEvent(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  eventType: string,
  payload: unknown
) {
  const currentQuotas = [...(state.resourceQuotas || [])];
  const currentLimitRanges = [...(state.limitRanges || [])];
  const payloadData = (payload as Record<string, unknown>) || {};
  const name = String(payloadData.name || "");
  const namespace = String(payloadData.namespace || "default");

  if (eventType === "EVENT_RESOURCE_QUOTA_MUTATED" || eventType === "EVENT_RESOURCE_QUOTA_ADDED") {
    const existingIdx = currentQuotas.findIndex((q) => q.name === name && q.namespace === namespace);
    const quotaData: K8sResourceQuotaData = {
      name,
      namespace,
      hard: (payloadData.hard as Record<string, string>) || {},
      used: (payloadData.used as Record<string, string>) || {},
      cpuLimitCores: typeof payloadData.cpuLimitCores === "number" ? payloadData.cpuLimitCores : undefined,
      cpuUsedCores: typeof payloadData.cpuUsedCores === "number" ? payloadData.cpuUsedCores : undefined,
      cpuUtilizationPct: typeof payloadData.cpuUtilizationPct === "number" ? payloadData.cpuUtilizationPct : undefined,
      memoryLimitBytes: typeof payloadData.memoryLimitBytes === "number" ? payloadData.memoryLimitBytes : undefined,
      memoryUsedBytes: typeof payloadData.memoryUsedBytes === "number" ? payloadData.memoryUsedBytes : undefined,
      memoryUtilizationPct: typeof payloadData.memoryUtilizationPct === "number" ? payloadData.memoryUtilizationPct : undefined,
      podsLimit: typeof payloadData.podsLimit === "number" ? payloadData.podsLimit : undefined,
      podsUsed: typeof payloadData.podsUsed === "number" ? payloadData.podsUsed : undefined,
      podsUtilizationPct: typeof payloadData.podsUtilizationPct === "number" ? payloadData.podsUtilizationPct : undefined,
      isBreached: Boolean(payloadData.isBreached),
      isWarning: Boolean(payloadData.isWarning),
      createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
    };

    if (existingIdx >= 0) {
      currentQuotas[existingIdx] = { ...currentQuotas[existingIdx], ...quotaData };
    } else {
      currentQuotas.push(quotaData);
    }
    set({ resourceQuotas: currentQuotas });
  } else if (eventType === "EVENT_RESOURCE_QUOTA_DELETED") {
    const filtered = currentQuotas.filter((q) => !(q.name === name && q.namespace === namespace));
    set({ resourceQuotas: filtered });
  } else if (eventType === "EVENT_LIMIT_RANGE_MUTATED" || eventType === "EVENT_LIMIT_RANGE_ADDED") {
    const existingIdx = currentLimitRanges.findIndex((lr) => lr.name === name && lr.namespace === namespace);
    const limitRangeData: K8sLimitRangeData = {
      name,
      namespace,
      limits: Array.isArray(payloadData.limits) ? (payloadData.limits as K8sLimitRangeData["limits"]) : [],
      createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
    };

    if (existingIdx >= 0) {
      currentLimitRanges[existingIdx] = { ...currentLimitRanges[existingIdx], ...limitRangeData };
    } else {
      currentLimitRanges.push(limitRangeData);
    }
    set({ limitRanges: currentLimitRanges });
  } else if (eventType === "EVENT_LIMIT_RANGE_DELETED") {
    const filtered = currentLimitRanges.filter((lr) => !(lr.name === name && lr.namespace === namespace));
    set({ limitRanges: filtered });
  }
}

/**
 * Finds the primary ResourceQuota governing a target namespace
 */
export function findNamespaceQuota(
  quotas: K8sResourceQuotaData[] = [],
  namespace: string = "default"
): K8sResourceQuotaData | null {
  if (!quotas || quotas.length === 0) return null;
  const targetNs = namespace || "default";
  return quotas.find((q) => (q.namespace || "default") === targetNs) || null;
}

/**
 * Finds all LimitRanges governing a target namespace
 */
export function findNamespaceLimitRanges(
  limitRanges: K8sLimitRangeData[] = [],
  namespace: string = "default"
): K8sLimitRangeData[] {
  if (!limitRanges || limitRanges.length === 0) return [];
  const targetNs = namespace || "default";
  return limitRanges.filter((lr) => (lr.namespace || "default") === targetNs);
}

/**
 * Evaluates highest resource utilization percentage and status
 */
export function getQuotaUtilizationSummary(quota?: K8sResourceQuotaData | null): {
  maxPct: number;
  status: "normal" | "warning" | "breached";
  label: string;
} | null {
  if (!quota) return null;

  const cpuPct = quota.cpuUtilizationPct ?? 0;
  const memPct = quota.memoryUtilizationPct ?? 0;
  const podsPct = quota.podsUtilizationPct ?? 0;

  const maxPct = Math.round(Math.max(cpuPct, memPct, podsPct));
  let status: "normal" | "warning" | "breached" = "normal";
  if (quota.isBreached || maxPct >= 100) {
    status = "breached";
  } else if (quota.isWarning || maxPct >= 85) {
    status = "warning";
  }

  let highestMetric = "CPU";
  if (memPct > cpuPct && memPct >= podsPct) {
    highestMetric = "Memory";
  } else if (podsPct > cpuPct && podsPct > memPct) {
    highestMetric = "Pods";
  }

  return {
    maxPct,
    status,
    label: `${highestMetric} ${maxPct}%`,
  };
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
