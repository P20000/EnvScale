import type { K8sDaemonSetData, K8sCronJobData } from "../types/topologyTypes";
import type { K8sReplicaSetData, K8sDeploymentData } from "./rolloutHelpers";

export function handleReplicaSetWsEvent(
  currentRS: K8sReplicaSetData[],
  payloadData: Record<string, unknown>,
  isDeleted: boolean
): K8sReplicaSetData[] {
  const name = String(payloadData.name || payloadData.id || "");
  if (!name) return currentRS;
  if (isDeleted) {
    return currentRS.filter((r) => r.name !== name);
  }
  const idx = currentRS.findIndex((r) => r.name === name);
  const existing = idx >= 0 ? currentRS[idx] : undefined;
  const newItem: K8sReplicaSetData = {
    name,
    namespace: String(payloadData.namespace || existing?.namespace || "default"),
    replicas: Number(payloadData.replicas ?? existing?.replicas ?? 0),
    readyReplicas: Number(payloadData.readyReplicas ?? existing?.readyReplicas ?? 0),
    ownerUid: payloadData.ownerUid ? String(payloadData.ownerUid) : existing?.ownerUid,
    ownerName: payloadData.ownerName ? String(payloadData.ownerName) : existing?.ownerName,
    ownerKind: payloadData.ownerKind ? String(payloadData.ownerKind) : existing?.ownerKind,
    labels: (payloadData.labels as Record<string, string>) || existing?.labels,
    revision: payloadData.revision ? String(payloadData.revision) : existing?.revision,
    images: (payloadData.images as string[]) || existing?.images,
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : existing?.createdAt,
  };
  if (idx >= 0) {
    const copy = [...currentRS];
    copy[idx] = newItem;
    return copy;
  }
  return [...currentRS, newItem];
}

export function handleDeploymentWsEvent(
  currentDeps: K8sDeploymentData[],
  payloadData: Record<string, unknown>,
  isDeleted: boolean
): K8sDeploymentData[] {
  const name = String(payloadData.name || payloadData.id || "");
  if (!name) return currentDeps;
  if (isDeleted) {
    return currentDeps.filter((d) => d.name !== name);
  }
  const idx = currentDeps.findIndex((d) => d.name === name);
  const newItem: K8sDeploymentData = {
    name,
    namespace: String(payloadData.namespace || "default"),
    replicas: Number(payloadData.replicas ?? 0),
    readyReplicas: Number(payloadData.readyReplicas ?? 0),
    selector: payloadData.selector as Record<string, string>,
    labels: payloadData.labels as Record<string, string>,
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
  };
  if (idx >= 0) {
    const copy = [...currentDeps];
    copy[idx] = { ...copy[idx], ...newItem };
    return copy;
  }
  return [...currentDeps, newItem];
}

export function handleDaemonSetWsEvent(
  currentDS: K8sDaemonSetData[],
  payloadData: Record<string, unknown>,
  isDeleted: boolean
): K8sDaemonSetData[] {
  const name = String(payloadData.name || payloadData.id || "");
  if (!name) return currentDS;
  if (isDeleted) {
    return currentDS.filter((d) => d.name !== name);
  }
  const idx = currentDS.findIndex((d) => d.name === name);
  const newItem: K8sDaemonSetData = {
    name,
    namespace: String(payloadData.namespace || "default"),
    desiredNumberScheduled: Number(payloadData.desiredNumberScheduled ?? 0),
    currentNumberScheduled: Number(payloadData.currentNumberScheduled ?? 0),
    numberReady: Number(payloadData.numberReady ?? 0),
    numberUnavailable: Number(payloadData.numberUnavailable ?? 0),
    images: (payloadData.images as string[]) || [],
    labels: (payloadData.labels as Record<string, string>) || {},
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
  };
  if (idx >= 0) {
    const copy = [...currentDS];
    copy[idx] = { ...copy[idx], ...newItem };
    return copy;
  }
  return [...currentDS, newItem];
}

export function handleCronJobWsEvent(
  currentCJ: K8sCronJobData[],
  payloadData: Record<string, unknown>,
  isDeleted: boolean
): K8sCronJobData[] {
  const name = String(payloadData.name || payloadData.id || "");
  if (!name) return currentCJ;
  if (isDeleted) {
    return currentCJ.filter((c) => c.name !== name);
  }
  const idx = currentCJ.findIndex((c) => c.name === name);
  const existing = idx >= 0 ? currentCJ[idx] : undefined;
  const newItem: K8sCronJobData = {
    name,
    namespace: String(payloadData.namespace || existing?.namespace || "default"),
    schedule: String(payloadData.schedule || existing?.schedule || "0 * * * *"),
    suspend: Boolean(payloadData.suspend ?? existing?.suspend ?? false),
    activeJobsCount: Number(payloadData.activeJobsCount ?? existing?.activeJobsCount ?? 0),
    lastScheduleTime: payloadData.lastScheduleTime
      ? String(payloadData.lastScheduleTime)
      : existing?.lastScheduleTime,
    lastSuccessfulTime: payloadData.lastSuccessfulTime
      ? String(payloadData.lastSuccessfulTime)
      : existing?.lastSuccessfulTime,
    images: (payloadData.images as string[]) || existing?.images || [],
    labels: (payloadData.labels as Record<string, string>) || existing?.labels || {},
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : existing?.createdAt,
  };
  if (idx >= 0) {
    const copy = [...currentCJ];
    copy[idx] = { ...copy[idx], ...newItem };
    return copy;
  }
  return [...currentCJ, newItem];
}
