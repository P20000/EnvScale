import type { Node } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sNodeData } from "../../components/canvas/K8sNode";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { TopologyState } from "../useTopologyStore";
import type { HistoryAction, NotificationItem } from "../types/topologyTypes";
import {
  extractServices,
  extractPods,
  syncSelectedNode,
  sanitizeManifestSnapshot,
} from "../helpers/topologyHelpers";

export function handleUndoAction(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void
) {
  const stack = get().undoStack;
  if (stack.length === 0) return;
  const [action, ...remainingUndo] = stack;

  if (action.type === "DELETE_RESOURCE") {
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
    const clusterId = get().activeCluster || "mini-todo";

    fetch(`${API_BASE_URL}/api/v1/resource/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId,
        namespace: action.namespace,
        resourceKind: action.resourceKind,
        resourceName: action.resourceName,
        manifest: action.manifestSnapshot,
      }),
    }).catch(() => {});

    const restoredNode: Node = {
      id: action.resourceName.startsWith("svc-") || action.resourceName.startsWith("pod-")
        ? action.resourceName
        : `${action.resourceKind.toLowerCase()}-${action.resourceName}`,
      type:
        action.resourceKind.toLowerCase() === "service"
          ? "k8sService"
          : action.resourceKind.toLowerCase() === "pod"
          ? "k8sPod"
          : "k8sWorkload",
      position: { x: 300, y: 200 },
      data: {
        name: action.resourceName,
        namespace: action.namespace,
        status: "Running",
        rawResource: action.manifestSnapshot,
      },
    };

    const currentRaw = get().rawNodes || [];
    const updatedRaw = [...currentRaw, restoredNode];
    const restoredEdges = [...(get().edges || []), ...(action.associatedEdges || [])];

    const newAlert: NotificationItem = {
      id: `notif-undo-${Date.now()}`,
      title: `Undo: Restoring ${action.resourceName}`,
      message: `Re-applied declarative manifest for ${action.resourceName} to ${action.namespace} in ${clusterId}.`,
      time: "Just now",
      severity: "INFO",
      read: false,
      cluster: clusterId,
    };

    set({
      undoStack: remainingUndo,
      redoStack: [action, ...get().redoStack].slice(0, 20),
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      edges: restoredEdges,
      notifications: [newAlert, ...get().notifications],
    });

    get().applyDagreLayout();
  }
}

export function handleRedoAction(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void
) {
  const stack = get().redoStack;
  if (stack.length === 0) return;
  const [action, ...remainingRedo] = stack;

  if (action.type === "DELETE_RESOURCE") {
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
    const clusterId = get().activeCluster || "mini-todo";

    fetch(`${API_BASE_URL}/api/v1/resource/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId,
        namespace: action.namespace,
        resourceKind: action.resourceKind,
        resourceName: action.resourceName,
      }),
    }).catch(() => {});

    get().removeTarget(action.resourceName, { skipHistory: true });

    const newAlert: NotificationItem = {
      id: `notif-redo-${Date.now()}`,
      title: `Redo: Re-deleting ${action.resourceName}`,
      message: `Re-issued deletion for ${action.resourceName} in ${action.namespace}.`,
      time: "Just now",
      severity: "WARNING",
      read: false,
      cluster: clusterId,
    };

    set({
      redoStack: remainingRedo,
      undoStack: [action, ...get().undoStack].slice(0, 20),
      notifications: [newAlert, ...get().notifications],
    });
  }
}

export function handleRemoveTarget(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  targetId: string,
  options?: { skipHistory?: boolean; skipApi?: boolean }
) {
  if (!targetId) return;
  const currentRaw = get().rawNodes || [];
  const currentNodes = get().nodes || [];

  const matchesTarget = (n: Node) => {
    if (n.id === targetId) return true;
    const d = n.data as Record<string, unknown> | undefined;
    if (!d) return false;
    const name = String(d.name || d.podName || d.serviceName || d.nodeName || "");
    return (
      name === targetId ||
      `svc-${name}` === targetId ||
      `pod-${name}` === targetId ||
      `node-${name}` === targetId ||
      `workload-${name}` === targetId
    );
  };

  const targetNode = currentRaw.find(matchesTarget) || currentNodes.find(matchesTarget);
  if (targetNode) {
    const resData = (targetNode.data as Record<string, unknown>) || {};
    const resName = String(resData.name || targetNode.id);
    const resKind = targetNode.type?.replace("k8s", "") || "Resource";
    const ns = String(resData.namespace || "default");

    if (!options?.skipApi) {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
      const clusterId = get().activeCluster || "mini-todo";
      fetch(`${API_BASE_URL}/api/v1/resource/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterId,
          namespace: ns,
          resourceKind: resKind,
          resourceName: resName,
        }),
      }).catch(() => {});
    }

    if (!options?.skipHistory) {
      const snapshot = sanitizeManifestSnapshot(targetNode);
      const associatedEdges = (get().edges || []).filter(
        (e) => e.source === targetNode.id || e.target === targetNode.id
      );

      const historyItem: HistoryAction = {
        type: "DELETE_RESOURCE",
        resourceKind: resKind,
        namespace: ns,
        resourceName: resName,
        manifestSnapshot: snapshot,
        associatedEdges,
        timestamp: Date.now(),
      };

      const newUndo = [historyItem, ...get().undoStack].slice(0, 20);
      set({ undoStack: newUndo, redoStack: [] });
    }
  }

  const remainingRaw = currentRaw.filter((n) => !matchesTarget(n));
  const remainingNodes = currentNodes.filter((n) => !matchesTarget(n));

  const remainingRawIds = new Set(remainingRaw.map((n) => n.id));
  const remainingEdges = get().edges.filter(
    (e) => remainingRawIds.has(e.source) && remainingRawIds.has(e.target)
  );

  const selected = get().selectedNode;
  const isSelected =
    selected &&
    (selected.data?.name === targetId ||
      (selected as unknown as Node).id === targetId);

  set({
    rawNodes: remainingRaw,
    nodes: remainingNodes,
    services: extractServices(remainingRaw),
    pods: extractPods(remainingRaw),
    ingresses: get().ingresses.filter((i) => i.name !== targetId),
    edges: remainingEdges,
    selectedNode: isSelected ? null : syncSelectedNode(remainingRaw, selected),
  });

  get().applyDagreLayout();
}

export function handleCreateNode(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  type: "k8sPod" | "k8sWorker" | "k8sService",
  customName?: string
) {
  const timestamp = Date.now();
  const count = get().nodes.filter((n) => n.type === type).length + 1;
  const posX = 200 + Math.random() * 350;
  const posY = 150 + Math.random() * 250;

  let newNode: Node;
  if (type === "k8sPod") {
    newNode = {
      id: `pod-${timestamp}`,
      type: "k8sPod",
      position: { x: posX, y: posY },
      data: {
        name: customName || `app-workload-${count}`,
        namespace: "default",
        status: "Running",
        restarts: 0,
        ip: `10.244.0.${Math.floor(Math.random() * 200 + 10)}`,
        cpuUsage: "32 mcores",
        memoryUsage: "110 MiB",
      } as K8sPodData,
    };
  } else if (type === "k8sWorker") {
    newNode = {
      id: `worker-${timestamp}`,
      type: "k8sWorker",
      position: { x: posX, y: posY },
      data: {
        name: customName || `k8s-node-${count}`,
        ip: `192.168.49.${Math.floor(Math.random() * 200 + 10)}`,
        osImage: "Ubuntu 22.04 LTS",
        cpuCapacity: "4 cores",
        memoryCapacity: "8 GiB",
        cpuPct: 35,
        memoryPct: 50,
        status: "Ready",
      } as K8sNodeData,
    };
  } else {
    newNode = {
      id: `service-${timestamp}`,
      type: "k8sService",
      position: { x: posX, y: posY },
      data: {
        name: customName || `service-router-${count}`,
        type: "ClusterIP",
        port: `:80${Math.floor(Math.random() * 80 + 10)}`,
      } as K8sServiceData,
    };
  }

  const nextNodes = [...get().nodes, newNode];
  set({
    nodes: nextNodes,
    services: extractServices(nextNodes),
    pods: extractPods(nextNodes),
  });
}
