import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sStatefulSetData, VolumeClaimTemplateInfo } from "../types/topologyTypes";
import type { TopologyState } from "../useTopologyStore";

/**
 * Extracts ordinal index integer from pod name (e.g. "redis-db-0" -> 0, "kafka-broker-3" -> 3)
 */
export const extractOrdinalIndex = (podName: string): number => {
  const match = podName.match(/-(0|[1-9]\d*)$/);
  return match ? parseInt(match[1], 10) : -1;
};

/**
 * Finds a matching StatefulSet by name and optional namespace
 */
export const findWorkloadStatefulSet = (
  statefulSets: K8sStatefulSetData[] | undefined,
  name: string,
  namespace?: string
): K8sStatefulSetData | undefined => {
  if (!statefulSets || statefulSets.length === 0) return undefined;
  const targetName = name.toLowerCase();
  return statefulSets.find((sts) => {
    const stsName = sts.name.toLowerCase();
    const matchesName = stsName === targetName;
    const matchesNs = !namespace || !sts.namespace || sts.namespace === namespace;
    return matchesName && matchesNs;
  });
};

/**
 * Determines whether a pod is managed by a StatefulSet
 */
export const isStatefulSetPod = (
  podData: K8sPodData,
  statefulSets: K8sStatefulSetData[] | undefined
): boolean => {
  if (podData?.ownerKind === "StatefulSet") return true;
  const podName = podData?.name || "";
  const ordinal = extractOrdinalIndex(podName);
  if (ordinal < 0) return false;

  const prefix = podName.replace(/-(0|[1-9]\d*)$/, "");
  if (findWorkloadStatefulSet(statefulSets, prefix, podData.namespace)) return true;

  // Fallback heuristic for stateful services with ordinal naming
  const lower = prefix.toLowerCase();
  return lower.includes("db") || lower.includes("redis") || lower.includes("stateful") || lower.includes("kafka") || lower.includes("postgres");
};

/**
 * Generates deterministic cluster FQDN for a given ordinal pod instance
 */
export const generateOrdinalFqdn = (
  podName: string,
  serviceName: string,
  namespace: string = "default"
): string => {
  return `${podName}.${serviceName}.${namespace}.svc.cluster.local`;
};

/**
 * Handles incoming WebSocket events for StatefulSet resources
 */
export function handleStatefulSetWsEvent(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  eventType: string,
  payloadData: Record<string, unknown>
): boolean {
  if (
    eventType === "EVENT_STATEFUL_SET_MUTATED" ||
    eventType === "EVENT_STATEFUL_SET_ADDED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return false;

    const currentSts = state.statefulSets || [];
    const idx = currentSts.findIndex((s) => s.name === name);
    const existing = idx >= 0 ? currentSts[idx] : undefined;

    const newItem: K8sStatefulSetData = {
      name,
      namespace: String(payloadData.namespace || existing?.namespace || "default"),
      replicas: Number(payloadData.replicas ?? existing?.replicas ?? 0),
      readyReplicas: Number(payloadData.readyReplicas ?? existing?.readyReplicas ?? 0),
      currentReplicas: Number(payloadData.currentReplicas ?? existing?.currentReplicas ?? 0),
      updatedReplicas: Number(payloadData.updatedReplicas ?? existing?.updatedReplicas ?? 0),
      serviceName: payloadData.serviceName ? String(payloadData.serviceName) : existing?.serviceName,
      currentRevision: payloadData.currentRevision ? String(payloadData.currentRevision) : existing?.currentRevision,
      updateRevision: payloadData.updateRevision ? String(payloadData.updateRevision) : existing?.updateRevision,
      updateStrategy: payloadData.updateStrategy ? String(payloadData.updateStrategy) : existing?.updateStrategy,
      partition: typeof payloadData.partition === "number" ? payloadData.partition : existing?.partition,
      volumeClaimTemplates: (payloadData.volumeClaimTemplates as VolumeClaimTemplateInfo[]) || existing?.volumeClaimTemplates,
      selector: (payloadData.selector as Record<string, string>) || existing?.selector,
      labels: (payloadData.labels as Record<string, string>) || existing?.labels,
      createdAt: payloadData.createdAt ? String(payloadData.createdAt) : existing?.createdAt,
    };

    let updatedSts: K8sStatefulSetData[];
    if (idx >= 0) {
      updatedSts = [...currentSts];
      updatedSts[idx] = newItem;
    } else {
      updatedSts = [...currentSts, newItem];
    }

    set({ statefulSets: updatedSts });
    state.applyDagreLayout();
    return true;
  }

  if (eventType === "EVENT_STATEFUL_SET_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return false;
    const currentSts = state.statefulSets || [];
    const updatedSts = currentSts.filter((s) => s.name !== name);
    set({ statefulSets: updatedSts });
    state.applyDagreLayout();
    return true;
  }

  return false;
}

/**
 * Builds a React Flow k8sStatefulSet node representing the digital infrastructure control board
 */
export function buildStatefulSetNode(
  prefix: string,
  ns: string,
  groupPods: Array<{ data?: unknown }>,
  podsData: K8sPodData[],
  readyCount: number,
  statefulSets: K8sStatefulSetData[],
  cpuUsagePct: number
) {
  const matchedSts = findWorkloadStatefulSet(statefulSets, prefix, ns);
  const totalReplicas = matchedSts?.replicas ?? Math.max(groupPods.length, podsData.length);
  const readyReplicas = matchedSts?.readyReplicas ?? readyCount;
  const serviceName = matchedSts?.serviceName || `${prefix}-headless-service`;
  const vct = matchedSts?.volumeClaimTemplates || [
    { name: "data", storage: "10 Gi", accessModes: "RWO" },
  ];

  return {
    id: `group-${prefix}`,
    type: "k8sStatefulSet",
    position: { x: 0, y: 0 },
    data: {
      name: matchedSts?.name || prefix,
      namespace: ns,
      replicas: totalReplicas,
      readyReplicas,
      currentReplicas: matchedSts?.currentReplicas,
      updatedReplicas: matchedSts?.updatedReplicas,
      serviceName,
      currentRevision: matchedSts?.currentRevision,
      updateRevision: matchedSts?.updateRevision,
      updateStrategy: matchedSts?.updateStrategy,
      partition: matchedSts?.partition,
      volumeClaimTemplates: vct,
      pods: podsData,
      cpuUsagePct,
    },
  };
}

