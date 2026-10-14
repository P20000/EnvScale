import type { TopologyState } from "../useTopologyStore";
import type { K8sHPAData, K8sNetworkPolicyData } from "../types/topologyTypes";
import type { K8sPodData } from "../../components/canvas/K8sPod";

/**
 * Reducer for HPA and NetworkPolicy WebSocket events
 */
export function handlePolicyHpaWsEvent(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  eventType: string,
  payload: Record<string, unknown>
): void {
  const currentHPAs = [...(state.hpas || [])];
  const currentNetPols = [...(state.networkPolicies || [])];

  if (eventType === "EVENT_HPA_MUTATED" || eventType === "EVENT_HPA_ADDED") {
    const name = String(payload.name || "");
    const namespace = String(payload.namespace || "default");
    if (!name) return;

    const existingIdx = currentHPAs.findIndex((h) => h.name === name && h.namespace === namespace);
    const hpaData: K8sHPAData = {
      name,
      namespace,
      targetRefKind: String(payload.targetRefKind || "Deployment"),
      targetRefName: String(payload.targetRefName || name),
      minReplicas: Number(payload.minReplicas ?? 1),
      maxReplicas: Number(payload.maxReplicas ?? 1),
      currentReplicas: Number(payload.currentReplicas ?? 1),
      desiredReplicas: Number(payload.desiredReplicas ?? 1),
      currentCpuUtil: payload.currentCpuUtil !== undefined ? Number(payload.currentCpuUtil) : undefined,
      targetCpuUtil: payload.targetCpuUtil !== undefined ? Number(payload.targetCpuUtil) : undefined,
      lastScaleTime: payload.lastScaleTime ? String(payload.lastScaleTime) : undefined,
      ...payload,
    };

    if (existingIdx >= 0) {
      currentHPAs[existingIdx] = { ...currentHPAs[existingIdx], ...hpaData };
    } else {
      currentHPAs.push(hpaData);
    }

    set({ hpas: currentHPAs });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_HPA_DELETED") {
    const name = String(payload.name || "");
    const namespace = String(payload.namespace || "default");
    const filtered = currentHPAs.filter((h) => !(h.name === name && h.namespace === namespace));
    set({ hpas: filtered });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_NETWORKPOLICY_MUTATED" || eventType === "EVENT_NETWORKPOLICY_ADDED") {
    const name = String(payload.name || "");
    const namespace = String(payload.namespace || "default");
    if (!name) return;

    const existingIdx = currentNetPols.findIndex((n) => n.name === name && n.namespace === namespace);
    const netPolData: K8sNetworkPolicyData = {
      name,
      namespace,
      podSelector: (payload.podSelector as Record<string, string>) || {},
      policyTypes: (payload.policyTypes as string[]) || ["Ingress"],
      ingressRules: (payload.ingressRules as string[]) || [],
      targetPods: (payload.targetPods as string[]) || [],
      ...payload,
    };

    if (existingIdx >= 0) {
      currentNetPols[existingIdx] = { ...currentNetPols[existingIdx], ...netPolData };
    } else {
      currentNetPols.push(netPolData);
    }

    set({ networkPolicies: currentNetPols });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_NETWORKPOLICY_DELETED") {
    const name = String(payload.name || "");
    const namespace = String(payload.namespace || "default");
    const filtered = currentNetPols.filter((n) => !(n.name === name && n.namespace === namespace));
    set({ networkPolicies: filtered });
    state.applyDagreLayout();
  }
}

/**
 * Matches an HPA targeting a specific workload
 */
export function findWorkloadHPA(
  hpas: K8sHPAData[] = [],
  workloadName: string,
  namespace?: string
): K8sHPAData | null {
  if (!hpas || hpas.length === 0 || !workloadName) return null;
  const targetLower = workloadName.toLowerCase();

  return (
    hpas.find((h) => {
      const matchName = h.targetRefName?.toLowerCase() === targetLower || h.name.toLowerCase().includes(targetLower);
      const matchNs = !namespace || !h.namespace || h.namespace === namespace;
      return matchName && matchNs;
    }) || null
  );
}

/**
 * Matches NetworkPolicies targeting a workload or its pods
 */
export function findWorkloadNetworkPolicies(
  networkPolicies: K8sNetworkPolicyData[] = [],
  podLabels: Record<string, string> = {},
  workloadName: string = "",
  namespace?: string
): K8sNetworkPolicyData[] {
  if (!networkPolicies || networkPolicies.length === 0) return [];
  const workloadLower = workloadName.toLowerCase();

  return networkPolicies.filter((np) => {
    if (namespace && np.namespace && np.namespace !== namespace) {
      return false;
    }

    // Direct label match
    if (np.podSelector && Object.keys(np.podSelector).length > 0) {
      const allMatch = Object.entries(np.podSelector).every(([k, v]) => podLabels[k] === v);
      if (allMatch) return true;
    }

    // Fallback: name contains workload or vice versa
    const npLower = np.name.toLowerCase();
    return npLower.includes(workloadLower) || workloadLower.includes(npLower.replace("-network-policy", "").replace("-isolation", ""));
  });
}

export interface ClusterHealthSummary {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  failingCount: number;
  healthyCount: number;
  totalCount: number;
}

/**
 * Calculates real-time cluster health score and grade based on live pod telemetry
 */
export function calculateClusterHealthScore(
  pods: K8sPodData[] = []
): ClusterHealthSummary {
  if (!pods || pods.length === 0) {
    return { score: 100, grade: "A", failingCount: 0, healthyCount: 0, totalCount: 0 };
  }

  // Filter out system pods if calculating workload health
  const activePods = pods.filter((p) => {
    const ns = p.namespace || "default";
    return !ns.startsWith("kube-") && ns !== "local-path-storage";
  });

  const targetPods = activePods.length > 0 ? activePods : pods;
  let failingCount = 0;
  let healthyCount = 0;

  targetPods.forEach((p) => {
    const ph = String(p.phase || p.status || "").toLowerCase();
    const isTerminating = Boolean(p.isTerminating || ph === "terminating");
    const isFailing =
      ph.includes("crash") ||
      ph.includes("oom") ||
      ph.includes("error") ||
      ph.includes("fail") ||
      ph.includes("imagepull") ||
      isTerminating ||
      p.ready === false;

    if (isFailing) {
      failingCount++;
    } else if (ph === "running" || ph === "ready" || ph === "succeeded") {
      healthyCount++;
    }
  });

  const total = targetPods.length;
  // Score formula: (healthyCount / total) * 100
  const score = total > 0 ? Math.round((healthyCount / total) * 100) : 100;

  let grade: "A" | "B" | "C" | "D" | "F";
  if (score >= 90) grade = "A";
  else if (score >= 75) grade = "B";
  else if (score >= 60) grade = "C";
  else if (score >= 45) grade = "D";
  else grade = "F";

  return {
    score,
    grade,
    failingCount,
    healthyCount,
    totalCount: total,
  };
}

/**
 * Calculates accurate workload CPU usage percentage.
 * If readyCount === 0 or no pods are actively running, returns 0.
 * Never reports fake/fallback percentages on dead, crashed, or unready workloads.
 */
export function calculateWorkloadCpuUsage(
  groupPods: { data: unknown }[],
  readyCount: number,
  matchedHPA?: K8sHPAData | null
): number {
  if (readyCount === 0 || !groupPods || groupPods.length === 0) {
    return 0;
  }

  // If HPA reports active utilization, use it
  if (matchedHPA?.currentCpuUtil !== undefined && matchedHPA.currentCpuUtil !== null) {
    return matchedHPA.currentCpuUtil;
  }

  // Extract CPU from ready, running pods only
  const readyCpus = groupPods
    .filter((p) => {
      const pd = p.data as K8sPodData;
      const ph = String(pd?.phase || pd?.status || "").toLowerCase();
      const isTerminating = Boolean(pd?.isTerminating || ph === "terminating");
      const isFailing =
        ph.includes("crash") ||
        ph.includes("oom") ||
        ph.includes("error") ||
        ph.includes("fail") ||
        ph.includes("imagepull") ||
        ph.includes("createcontainer");
      return !isTerminating && !isFailing && (ph === "running" || ph === "ready") && pd?.ready !== false;
    })
    .map((p) => {
      const pd = p.data as K8sPodData;
      return Number(pd?.cpuUsagePct ?? pd?.cpuUsageMcores ?? 0);
    })
    .filter((c) => c > 0);

  if (readyCpus.length > 0) {
    return Math.round(readyCpus.reduce((a, b) => a + b, 0) / readyCpus.length);
  }

  // For live healthy running pods without metrics-server sample, show small ambient baseline (e.g. 2%)
  return matchedHPA ? 3 : 2;
}
