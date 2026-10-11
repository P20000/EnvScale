import type { Node, Edge } from "@xyflow/react";
import type { K8sPVCData, K8sPVData } from "../types/topologyTypes";
import type { K8sPodData } from "../../components/canvas/K8sPod";
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
  const groups = nodes.filter((n) => n.type === "k8sGroup");
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
          const strokeColor = isBound ? "#06b6d4" : "#f59e0b";
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
        const strokeColor = isBound ? "#06b6d4" : "#f59e0b";
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

