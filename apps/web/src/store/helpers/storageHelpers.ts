import type { Node, Edge } from "@xyflow/react";
import type { K8sPVCData, K8sPVData, K8sVolumeSnapshotData, K8sVolumeSnapshotContentData } from "../types/topologyTypes";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { TopologyState } from "../useTopologyStore";
import { SYSTEM_NAMESPACES } from "./topologyHelpers";

export const filterPVCs = (
  pvcs: K8sPVCData[],
  selectedNamespaces: string[] = [],
  showSystemNamespaces: boolean = false,
  showStorage: boolean = true
): K8sPVCData[] => {
  if (!showStorage || !Array.isArray(pvcs)) return [];

  const nsList = Array.isArray(selectedNamespaces)
    ? selectedNamespaces
    : selectedNamespaces
    ? [selectedNamespaces]
    : [];

  return pvcs.filter((pvc) => {
    const ns = pvc.namespace || "default";
    if (!showSystemNamespaces && SYSTEM_NAMESPACES.has(ns)) return false;
    if (nsList.length > 0 && !nsList.includes(ns)) return false;
    return true;
  });
};

export const createPVCCanvasNodes = (pvcs: K8sPVCData[]): Node[] => {
  return pvcs.map((pvc, idx) => ({
    id: `pvc-${pvc.namespace}-${pvc.name}`,
    type: "k8sPVC",
    position: { x: 750 + (idx % 3) * 220, y: 150 + Math.floor(idx / 3) * 110 },
    data: {
      ...pvc,
    },
  }));
};

export const filterPVCsForDisplay = (
  pvcs: K8sPVCData[],
  showStorage: boolean = true,
  showSystemNamespaces: boolean = false,
  selectedNamespaces: string[] = []
): K8sPVCData[] => {
  return filterPVCs(pvcs, selectedNamespaces, showSystemNamespaces, showStorage);
};

export const createPVCReactFlowNodes = createPVCCanvasNodes;

export const generateStorageEdges = (nodes: Node[]): Edge[] => {
  const edges: Edge[] = [];
  if (!nodes || nodes.length === 0) return edges;

  const pods = nodes.filter((n) => n.type === "k8sPod");
  const groups = nodes.filter((n) => n.type === "k8sGroup" || n.type === "k8sStatefulSet");
  const pvcNodes = nodes.filter((n) => n.type === "k8sPVC");
  if ((pods.length === 0 && groups.length === 0) || pvcNodes.length === 0) return edges;

  // 1. Connect Workload Groups (Deployments, StatefulSets) to target PVCs
  groups.forEach((group) => {
    const groupData = group.data as Record<string, unknown> | undefined;
    const groupPods = (groupData?.pods as K8sPodData[]) || [];
    const seenPVC = new Set<string>();

    groupPods.forEach((podData) => {
      if (!Array.isArray(podData.volumes) || podData.volumes.length === 0) return;

      podData.volumes.forEach((vol) => {
        if (!vol.pvcName || seenPVC.has(vol.pvcName)) return;

        const targetPVC = pvcNodes.find((pvcNode) => {
          const pvcData = pvcNode.data as K8sPVCData;
          return pvcData.name === vol.pvcName && (pvcData.namespace === podData.namespace || !podData.namespace);
        });

        if (targetPVC) {
          seenPVC.add(vol.pvcName);
          const pvcData = targetPVC.data as K8sPVCData;
          const isBound = pvcData.phase === "Bound";
          const strokeColor = isBound ? "#80DEEA" : "#F4C26B";
          const mountLabel = vol.mountPath ? `📁 ${vol.mountPath}` : undefined;

          edges.push({
            id: `e-storage-${group.id}-${targetPVC.id}`,
            source: group.id,
            target: targetPVC.id,
            type: "k8sEdge",
            animated: false,
            label: mountLabel,
            data: {
              label: mountLabel,
              strokeColor,
              healthStatus: isBound ? "healthy" : "degraded",
            },
            style: {
              stroke: strokeColor,
              strokeWidth: 1.5,
              strokeDasharray: "4 4",
            },
          });
        }
      });
    });
  });

  // 2. Connect any standalone Pods (if not grouped)
  pods.forEach((pod) => {
    const podData = pod.data as K8sPodData | undefined;
    if (!podData || !Array.isArray(podData.volumes) || podData.volumes.length === 0) return;

    podData.volumes.forEach((vol) => {
      if (!vol.pvcName) return;

      const targetPVC = pvcNodes.find((pvcNode) => {
        const pvcData = pvcNode.data as K8sPVCData;
        return pvcData.name === vol.pvcName && (pvcData.namespace === podData.namespace || !podData.namespace);
      });

      if (targetPVC) {
        const pvcData = targetPVC.data as K8sPVCData;
        const isBound = pvcData.phase === "Bound";
        const strokeColor = isBound ? "#80DEEA" : "#F4C26B";
        const mountLabel = vol.mountPath ? `📁 ${vol.mountPath}` : undefined;

        edges.push({
          id: `e-storage-${pod.id}-${targetPVC.id}-${vol.name}`,
          source: pod.id,
          target: targetPVC.id,
          type: "k8sEdge",
          animated: false,
          label: mountLabel,
          data: {
            label: mountLabel,
            strokeColor,
            healthStatus: isBound ? "healthy" : "degraded",
          },
          style: {
            stroke: strokeColor,
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
          },
        });
      }
    });
  });

  return edges;
};

export const handlePVCWsEvent = (
  currentPVCs: K8sPVCData[],
  payloadData: Record<string, unknown>,
  isDelete: boolean
): K8sPVCData[] => {
  const name = String(payloadData.name || payloadData.id || "");
  const namespace = String(payloadData.namespace || "default");
  if (!name) return currentPVCs;

  if (isDelete) {
    return currentPVCs.filter((p) => !(p.name === name && p.namespace === namespace));
  }

  const idx = currentPVCs.findIndex((p) => p.name === name && p.namespace === namespace);
  const newItem: K8sPVCData = {
    name,
    namespace,
    phase: (String(payloadData.phase || "Bound") as "Bound" | "Pending" | "Lost"),
    volumeName: payloadData.volumeName ? String(payloadData.volumeName) : undefined,
    storageClassName: payloadData.storageClassName ? String(payloadData.storageClassName) : undefined,
    requestedSize: payloadData.requestedSize ? String(payloadData.requestedSize) : undefined,
    capacity: payloadData.capacity ? String(payloadData.capacity) : undefined,
    accessModes: Array.isArray(payloadData.accessModes) ? (payloadData.accessModes as string[]) : undefined,
    volumeMode: payloadData.volumeMode ? String(payloadData.volumeMode) : undefined,
    labels: (payloadData.labels as Record<string, string>) || {},
    dataSource: payloadData.dataSource && typeof payloadData.dataSource === "object"
      ? (payloadData.dataSource as { apiGroup?: string; kind: string; name: string })
      : undefined,
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
  };

  if (idx >= 0) {
    const updated = [...currentPVCs];
    updated[idx] = { ...updated[idx], ...newItem };
    return updated;
  }
  return [...currentPVCs, newItem];
};

export const handlePVWsEvent = (
  currentPVs: K8sPVData[],
  payloadData: Record<string, unknown>,
  isDelete: boolean
): K8sPVData[] => {
  const name = String(payloadData.name || payloadData.id || "");
  if (!name) return currentPVs;

  if (isDelete) {
    return currentPVs.filter((p) => p.name !== name);
  }

  const idx = currentPVs.findIndex((p) => p.name === name);
  const newItem: K8sPVData = {
    name,
    phase: (String(payloadData.phase || "Available") as "Available" | "Bound" | "Released" | "Failed"),
    capacity: payloadData.capacity ? String(payloadData.capacity) : undefined,
    accessModes: Array.isArray(payloadData.accessModes) ? (payloadData.accessModes as string[]) : undefined,
    reclaimPolicy: payloadData.reclaimPolicy ? String(payloadData.reclaimPolicy) : undefined,
    storageClassName: payloadData.storageClassName ? String(payloadData.storageClassName) : undefined,
    claimRefName: payloadData.claimRefName ? String(payloadData.claimRefName) : undefined,
    claimRefNs: payloadData.claimRefNs ? String(payloadData.claimRefNs) : undefined,
    volumeSourceType: payloadData.volumeSourceType ? String(payloadData.volumeSourceType) : "Unknown",
    labels: (payloadData.labels as Record<string, string>) || {},
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
  };

  if (idx >= 0) {
    const updated = [...currentPVs];
    updated[idx] = { ...updated[idx], ...newItem };
    return updated;
  }
  return [...currentPVs, newItem];
};

export const handleVolumeSnapshotWsEvent = (
  currentSnapshots: K8sVolumeSnapshotData[],
  payloadData: Record<string, unknown>,
  isDelete: boolean
): K8sVolumeSnapshotData[] => {
  const name = String(payloadData.name || payloadData.id || "");
  const namespace = String(payloadData.namespace || "default");
  if (!name) return currentSnapshots;

  if (isDelete) {
    return currentSnapshots.filter((s) => !(s.name === name && s.namespace === namespace));
  }

  const idx = currentSnapshots.findIndex((s) => s.name === name && s.namespace === namespace);
  const newItem: K8sVolumeSnapshotData = {
    name,
    namespace,
    readyToUse: typeof payloadData.readyToUse === "boolean" ? payloadData.readyToUse : undefined,
    restoreSize: payloadData.restoreSize ? String(payloadData.restoreSize) : undefined,
    pvcName: payloadData.pvcName ? String(payloadData.pvcName) : undefined,
    snapshotContentName: payloadData.snapshotContentName ? String(payloadData.snapshotContentName) : undefined,
    snapshotClassName: payloadData.snapshotClassName ? String(payloadData.snapshotClassName) : undefined,
    creationTime: payloadData.creationTime ? String(payloadData.creationTime) : undefined,
    error: payloadData.error ? String(payloadData.error) : undefined,
    labels: (payloadData.labels as Record<string, string>) || {},
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
  };

  if (idx >= 0) {
    const updated = [...currentSnapshots];
    updated[idx] = { ...updated[idx], ...newItem };
    return updated;
  }
  return [...currentSnapshots, newItem];
};

export const handleVolumeSnapshotContentWsEvent = (
  currentContents: K8sVolumeSnapshotContentData[],
  payloadData: Record<string, unknown>,
  isDelete: boolean
): K8sVolumeSnapshotContentData[] => {
  const name = String(payloadData.name || payloadData.id || "");
  if (!name) return currentContents;

  if (isDelete) {
    return currentContents.filter((c) => c.name !== name);
  }

  const idx = currentContents.findIndex((c) => c.name === name);
  const newItem: K8sVolumeSnapshotContentData = {
    name,
    snapshotHandle: payloadData.snapshotHandle ? String(payloadData.snapshotHandle) : undefined,
    driver: payloadData.driver ? String(payloadData.driver) : undefined,
    deletionPolicy: payloadData.deletionPolicy ? String(payloadData.deletionPolicy) : undefined,
    snapshotClassName: payloadData.snapshotClassName ? String(payloadData.snapshotClassName) : undefined,
    volumeSnapshotRef: payloadData.volumeSnapshotRef ? String(payloadData.volumeSnapshotRef) : undefined,
    readyToUse: typeof payloadData.readyToUse === "boolean" ? payloadData.readyToUse : undefined,
    restoreSize: typeof payloadData.restoreSize === "number" ? payloadData.restoreSize : undefined,
    labels: (payloadData.labels as Record<string, string>) || {},
    createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
  };

  if (idx >= 0) {
    const updated = [...currentContents];
    updated[idx] = { ...updated[idx], ...newItem };
    return updated;
  }
  return [...currentContents, newItem];
};

export const handleStorageEventDispatch = (
  eventType: string,
  payloadData: Record<string, unknown>,
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void
): boolean => {
  if (eventType === "EVENT_PVC_MUTATED" || eventType === "EVENT_PVC_ADDED") {
    const currentPVCs = state.pvcs || [];
    const updatedPVCs = handlePVCWsEvent(currentPVCs, payloadData, false);
    set({ pvcs: updatedPVCs });
    state.applyDagreLayout();
    return true;
  }
  if (eventType === "EVENT_PVC_DELETED") {
    const currentPVCs = state.pvcs || [];
    const updatedPVCs = handlePVCWsEvent(currentPVCs, payloadData, true);
    set({ pvcs: updatedPVCs });
    state.applyDagreLayout();
    return true;
  }
  if (eventType === "EVENT_PV_MUTATED" || eventType === "EVENT_PV_ADDED") {
    set({ pvs: handlePVWsEvent(state.pvs || [], payloadData, false) });
    return true;
  }
  if (eventType === "EVENT_PV_DELETED") {
    set({ pvs: handlePVWsEvent(state.pvs || [], payloadData, true) });
    return true;
  }
  if (eventType === "EVENT_VOLUME_SNAPSHOT_MUTATED" || eventType === "EVENT_VOLUME_SNAPSHOT_ADDED") {
    set({ volumeSnapshots: handleVolumeSnapshotWsEvent(state.volumeSnapshots || [], payloadData, false) });
    return true;
  }
  if (eventType === "EVENT_VOLUME_SNAPSHOT_DELETED") {
    set({ volumeSnapshots: handleVolumeSnapshotWsEvent(state.volumeSnapshots || [], payloadData, true) });
    return true;
  }
  if (eventType === "EVENT_VOLUME_SNAPSHOT_CONTENT_MUTATED" || eventType === "EVENT_VOLUME_SNAPSHOT_CONTENT_ADDED") {
    set({ volumeSnapshotContents: handleVolumeSnapshotContentWsEvent(state.volumeSnapshotContents || [], payloadData, false) });
    return true;
  }
  if (eventType === "EVENT_VOLUME_SNAPSHOT_CONTENT_DELETED") {
    set({ volumeSnapshotContents: handleVolumeSnapshotContentWsEvent(state.volumeSnapshotContents || [], payloadData, true) });
    return true;
  }
  return false;
};



