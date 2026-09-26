import type { Node } from "@xyflow/react";
import type { K8sPVCData } from "../../components/canvas/K8sPVC";
import type {
  K8sPVData,
  K8sStorageClassData,
  K8sVolumeSnapshotData,
  K8sVolumeSnapshotContentData,
} from "../types/topologyTypes";
import type { TopologyState } from "../useTopologyStore";
import {
  extractServices,
  extractPods,
  syncSelectedNode,
} from "../helpers/topologyHelpers";

export function parseStorageSnapshotNodes(payloadData: Record<string, unknown>): Node[] {
  const nodes: Node[] = [];

  // 1. PVCs
  const snapshotPVCs = Array.isArray(payloadData.pvcs)
    ? (payloadData.pvcs as Record<string, unknown>[])
    : [];
  snapshotPVCs.forEach((pvc) => {
    const name = String(pvc.name || pvc.id || "");
    if (!name) return;
    const rawPhase = String(pvc.phase || pvc.status || "Bound");
    nodes.push({
      id: `pvc-${name}`,
      type: "k8sPVC",
      position: { x: 450, y: 350 },
      data: {
        name,
        namespace: String(pvc.namespace || "default"),
        status: rawPhase,
        phase: rawPhase,
        requestedCapacity: String(pvc.requestedCapacity || pvc.capacity || ""),
        actualCapacity: pvc.actualCapacity ? String(pvc.actualCapacity) : undefined,
        storageClassName: String(pvc.storageClassName || pvc.storageClass || "standard"),
        accessModes: Array.isArray(pvc.accessModes) ? (pvc.accessModes as string[]) : ["ReadWriteOnce"],
        volumeName: pvc.volumeName ? String(pvc.volumeName) : undefined,
        volumeMode: String(pvc.volumeMode || "Filesystem"),
        labels: pvc.labels as Record<string, string> | undefined,
        annotations: pvc.annotations as Record<string, string> | undefined,
        createdAt: pvc.createdAt ? String(pvc.createdAt) : undefined,
        ...pvc,
      } as K8sPVCData,
    });
  });

  // 2. PersistentVolumes
  const snapshotPVs = Array.isArray(payloadData.pvs)
    ? (payloadData.pvs as Record<string, unknown>[])
    : Array.isArray(payloadData.persistentVolumes)
    ? (payloadData.persistentVolumes as Record<string, unknown>[])
    : [];
  snapshotPVs.forEach((pv) => {
    const name = String(pv.name || pv.id || "");
    if (!name) return;
    const rawStatus = String(pv.status || (pv.rawResource as Record<string, unknown>)?.status?.phase || "Available");
    nodes.push({
      id: `pv-${name}`,
      type: "k8sPV",
      position: { x: 450, y: 450 },
      data: {
        name,
        status: rawStatus,
        capacity: pv.capacity ? String(pv.capacity) : undefined,
        accessModes: Array.isArray(pv.accessModes) ? (pv.accessModes as string[]) : ["ReadWriteOnce"],
        reclaimPolicy: pv.reclaimPolicy ? String(pv.reclaimPolicy) : "Retain",
        storageClassName: pv.storageClassName ? String(pv.storageClassName) : undefined,
        volumeMode: pv.volumeMode ? String(pv.volumeMode) : "Filesystem",
        claimRef: pv.claimRef as { name: string; namespace: string } | undefined,
        volumeSource: pv.volumeSource ? String(pv.volumeSource) : undefined,
        csiDriver: pv.csiDriver ? String(pv.csiDriver) : undefined,
        csiVolumeHandle: pv.csiVolumeHandle ? String(pv.csiVolumeHandle) : undefined,
        labels: pv.labels as Record<string, string> | undefined,
        annotations: pv.annotations as Record<string, string> | undefined,
        createdAt: pv.createdAt ? String(pv.createdAt) : undefined,
        ...pv,
      } as K8sPVData,
    });
  });

  // 3. StorageClasses
  const snapshotSCs = Array.isArray(payloadData.storageClasses)
    ? (payloadData.storageClasses as Record<string, unknown>[])
    : [];
  snapshotSCs.forEach((sc) => {
    const name = String(sc.name || sc.id || "");
    if (!name) return;
    nodes.push({
      id: `sc-${name}`,
      type: "k8sStorageClass",
      position: { x: 450, y: 550 },
      data: {
        name,
        provisioner: String(sc.provisioner || "kubernetes.io/no-provisioner"),
        reclaimPolicy: sc.reclaimPolicy ? String(sc.reclaimPolicy) : "Delete",
        volumeBindingMode: sc.volumeBindingMode ? String(sc.volumeBindingMode) : "Immediate",
        allowVolumeExpansion: Boolean(sc.allowVolumeExpansion),
        parameters: sc.parameters as Record<string, string> | undefined,
        labels: sc.labels as Record<string, string> | undefined,
        annotations: sc.annotations as Record<string, string> | undefined,
        createdAt: sc.createdAt ? String(sc.createdAt) : undefined,
        ...sc,
      } as K8sStorageClassData,
    });
  });

  // 4. VolumeSnapshots
  const snapshotVSs = Array.isArray(payloadData.volumeSnapshots)
    ? (payloadData.volumeSnapshots as Record<string, unknown>[])
    : [];
  snapshotVSs.forEach((vs) => {
    const name = String(vs.name || vs.id || "");
    if (!name) return;
    nodes.push({
      id: `snapshot-${name}`,
      type: "k8sVolumeSnapshot",
      position: { x: 700, y: 350 },
      data: {
        name,
        namespace: String(vs.namespace || "default"),
        readyToUse: Boolean(vs.readyToUse),
        sourcePVCName: vs.sourcePVCName ? String(vs.sourcePVCName) : undefined,
        volumeSnapshotClassName: vs.volumeSnapshotClassName ? String(vs.volumeSnapshotClassName) : undefined,
        snapshotContentName: vs.snapshotContentName ? String(vs.snapshotContentName) : undefined,
        restoreSize: vs.restoreSize ? String(vs.restoreSize) : undefined,
        labels: vs.labels as Record<string, string> | undefined,
        annotations: vs.annotations as Record<string, string> | undefined,
        createdAt: vs.createdAt ? String(vs.createdAt) : undefined,
        ...vs,
      } as K8sVolumeSnapshotData,
    });
  });

  // 5. VolumeSnapshotContents
  const snapshotVSCs = Array.isArray(payloadData.volumeSnapshotContents)
    ? (payloadData.volumeSnapshotContents as Record<string, unknown>[])
    : [];
  snapshotVSCs.forEach((vsc) => {
    const name = String(vsc.name || vsc.id || "");
    if (!name) return;
    nodes.push({
      id: `snapcontent-${name}`,
      type: "k8sVolumeSnapshotContent",
      position: { x: 700, y: 450 },
      data: {
        name,
        driver: vsc.driver ? String(vsc.driver) : undefined,
        snapshotHandle: vsc.snapshotHandle ? String(vsc.snapshotHandle) : undefined,
        deletionPolicy: vsc.deletionPolicy ? String(vsc.deletionPolicy) : "Delete",
        volumeSnapshotRef: vsc.volumeSnapshotRef as { name: string; namespace: string } | undefined,
        sourceVolumeHandle: vsc.sourceVolumeHandle ? String(vsc.sourceVolumeHandle) : undefined,
        restoreSize: typeof vsc.restoreSize === "number" ? vsc.restoreSize : undefined,
        labels: vsc.labels as Record<string, string> | undefined,
        createdAt: vsc.createdAt ? String(vsc.createdAt) : undefined,
        ...vsc,
      } as K8sVolumeSnapshotContentData,
    });
  });

  return nodes;
}

export function handleStorageEvents(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  currentRaw: Node[],
  eventType: string,
  payloadData: Record<string, unknown>
): boolean {
  // 1. PVC events
  if (
    eventType === "EVENT_PVC_ADDED" ||
    eventType === "EVENT_PVC_MUTATED" ||
    eventType === "EVENT_PVC_MODIFIED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const rawPhase = String(payloadData.phase || payloadData.status || "Bound");
    const idx = currentRaw.findIndex(
      (n) => n.id === name || n.id === `pvc-${name}` || (n.data as K8sPVCData)?.name === name
    );
    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: {
          ...(existing.data as K8sPVCData),
          ...payloadData,
          name,
          status: rawPhase,
          phase: rawPhase,
        },
      };
    } else {
      updatedRaw = [
        ...currentRaw,
        {
          id: `pvc-${name}`,
          type: "k8sPVC",
          position: { x: 450, y: 350 },
          data: {
            name,
            namespace: String(payloadData.namespace || "default"),
            status: rawPhase,
            phase: rawPhase,
            ...payloadData,
          } as K8sPVCData,
        },
      ];
    }
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  if (eventType === "EVENT_PVC_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const updatedRaw = currentRaw.filter(
      (n) => n.id !== name && n.id !== `pvc-${name}` && (n.data as Record<string, unknown>)?.name !== name
    );
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  // 2. PersistentVolume events
  if (
    eventType === "EVENT_PV_ADDED" ||
    eventType === "EVENT_PV_MUTATED" ||
    eventType === "EVENT_PV_MODIFIED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const rawStatus = String(payloadData.status || (payloadData.rawResource as Record<string, unknown>)?.status?.phase || "Available");
    const idx = currentRaw.findIndex(
      (n) => n.id === name || n.id === `pv-${name}` || (n.data as K8sPVData)?.name === name
    );
    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: {
          ...(existing.data as K8sPVData),
          ...payloadData,
          name,
          status: rawStatus,
        },
      };
    } else {
      updatedRaw = [
        ...currentRaw,
        {
          id: `pv-${name}`,
          type: "k8sPV",
          position: { x: 450, y: 450 },
          data: {
            name,
            status: rawStatus,
            reclaimPolicy: "Retain",
            volumeMode: "Filesystem",
            ...payloadData,
          } as K8sPVData,
        },
      ];
    }
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  if (eventType === "EVENT_PV_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const updatedRaw = currentRaw.filter(
      (n) => n.id !== name && n.id !== `pv-${name}` && (n.data as Record<string, unknown>)?.name !== name
    );
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  // 3. StorageClass events
  if (
    eventType === "EVENT_STORAGECLASS_ADDED" ||
    eventType === "EVENT_STORAGECLASS_MUTATED" ||
    eventType === "EVENT_STORAGECLASS_MODIFIED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const idx = currentRaw.findIndex(
      (n) => n.id === name || n.id === `sc-${name}` || (n.data as K8sStorageClassData)?.name === name
    );
    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: {
          ...(existing.data as K8sStorageClassData),
          ...payloadData,
          name,
        },
      };
    } else {
      updatedRaw = [
        ...currentRaw,
        {
          id: `sc-${name}`,
          type: "k8sStorageClass",
          position: { x: 450, y: 550 },
          data: {
            name,
            provisioner: String(payloadData.provisioner || "kubernetes.io/no-provisioner"),
            reclaimPolicy: String(payloadData.reclaimPolicy || "Delete"),
            volumeBindingMode: String(payloadData.volumeBindingMode || "Immediate"),
            ...payloadData,
          } as K8sStorageClassData,
        },
      ];
    }
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  if (eventType === "EVENT_STORAGECLASS_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const updatedRaw = currentRaw.filter(
      (n) => n.id !== name && n.id !== `sc-${name}` && (n.data as Record<string, unknown>)?.name !== name
    );
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  // 4. VolumeSnapshot events
  if (
    eventType === "EVENT_VOLUMESNAPSHOT_ADDED" ||
    eventType === "EVENT_VOLUMESNAPSHOT_MUTATED" ||
    eventType === "EVENT_VOLUMESNAPSHOT_MODIFIED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const idx = currentRaw.findIndex(
      (n) => n.id === name || n.id === `snapshot-${name}` || (n.data as K8sVolumeSnapshotData)?.name === name
    );
    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: {
          ...(existing.data as K8sVolumeSnapshotData),
          ...payloadData,
          name,
        },
      };
    } else {
      updatedRaw = [
        ...currentRaw,
        {
          id: `snapshot-${name}`,
          type: "k8sVolumeSnapshot",
          position: { x: 700, y: 350 },
          data: {
            name,
            namespace: String(payloadData.namespace || "default"),
            readyToUse: Boolean(payloadData.readyToUse),
            ...payloadData,
          } as K8sVolumeSnapshotData,
        },
      ];
    }
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  if (eventType === "EVENT_VOLUMESNAPSHOT_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const updatedRaw = currentRaw.filter(
      (n) => n.id !== name && n.id !== `snapshot-${name}` && (n.data as Record<string, unknown>)?.name !== name
    );
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  // 5. VolumeSnapshotContent events
  if (
    eventType === "EVENT_VOLUMESNAPSHOTCONTENT_ADDED" ||
    eventType === "EVENT_VOLUMESNAPSHOTCONTENT_MUTATED" ||
    eventType === "EVENT_VOLUMESNAPSHOTCONTENT_MODIFIED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const idx = currentRaw.findIndex(
      (n) => n.id === name || n.id === `snapcontent-${name}` || (n.data as K8sVolumeSnapshotContentData)?.name === name
    );
    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: {
          ...(existing.data as K8sVolumeSnapshotContentData),
          ...payloadData,
          name,
        },
      };
    } else {
      updatedRaw = [
        ...currentRaw,
        {
          id: `snapcontent-${name}`,
          type: "k8sVolumeSnapshotContent",
          position: { x: 700, y: 450 },
          data: {
            name,
            deletionPolicy: "Delete",
            ...payloadData,
          } as K8sVolumeSnapshotContentData,
        },
      ];
    }
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  if (eventType === "EVENT_VOLUMESNAPSHOTCONTENT_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return true;
    const updatedRaw = currentRaw.filter(
      (n) => n.id !== name && n.id !== `snapcontent-${name}` && (n.data as Record<string, unknown>)?.name !== name
    );
    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
    return true;
  }

  return false;
}
