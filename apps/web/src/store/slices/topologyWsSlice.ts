import type { Node } from "@xyflow/react";
import type { WsTopologyMessage } from "../../hooks/useK8sStream";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sNodeData } from "../../components/canvas/K8sNode";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData } from "../../components/canvas/K8sIngress";
import type { K8sReplicaSetData, K8sDeploymentData } from "../helpers/rolloutHelpers";
import type { TopologyState } from "../useTopologyStore";
import {
  extractServices,
  extractPods,
  syncSelectedNode,
} from "../helpers/topologyHelpers";

export function handleWsMessage(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  msg: WsTopologyMessage
) {
  const eventType = String(msg.event || msg.type || "");
  const payloadData = (msg.data !== undefined ? msg.data : msg.payload) as Record<string, unknown> | undefined;
  if (!eventType) return;

  if (eventType === "EVENT_BATCH_COMPLETE") {
    state.applyDagreLayout();
    return;
  }

  if (!payloadData) return;

  const currentRaw = state.rawNodes && state.rawNodes.length > 0 ? state.rawNodes : state.nodes;

  if (eventType === "EVENT_TOPOLOGY_SNAPSHOT" && Array.isArray(payloadData.nodes)) {
    const snapshotNodes = payloadData.nodes as Node[];
    set({
      rawNodes: snapshotNodes,
      services: extractServices(snapshotNodes),
      pods: extractPods(snapshotNodes),
    });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_SNAPSHOT_SYNC" && payloadData) {
    const snapshotPods = Array.isArray(payloadData.pods) ? (payloadData.pods as Record<string, unknown>[]) : [];
    const snapshotNodes = Array.isArray(payloadData.nodes) ? (payloadData.nodes as Record<string, unknown>[]) : [];
    const snapshotServices = Array.isArray(payloadData.services) ? (payloadData.services as Record<string, unknown>[]) : [];
    const snapshotIngresses = Array.isArray(payloadData.ingresses) ? (payloadData.ingresses as Record<string, unknown>[]) : [];

    let totalCpu = 0;
    let totalMemKi = 0;
    for (const n of snapshotNodes) {
      if (n.cpuCapacity) {
        const cpuNum = parseFloat(String(n.cpuCapacity));
        if (!isNaN(cpuNum)) totalCpu += cpuNum;
      }
      if (n.memoryCapacity) {
        const memStr = String(n.memoryCapacity);
        if (memStr.endsWith("Ki")) {
          const ki = parseFloat(memStr.replace("Ki", ""));
          if (!isNaN(ki)) totalMemKi += ki;
        } else if (memStr.endsWith("Mi")) {
          const mi = parseFloat(memStr.replace("Mi", ""));
          if (!isNaN(mi)) totalMemKi += mi * 1024;
        } else if (memStr.endsWith("Gi")) {
          const gi = parseFloat(memStr.replace("Gi", ""));
          if (!isNaN(gi)) totalMemKi += gi * 1024 * 1024;
        }
      }
    }

    const parsedCpu = totalCpu > 0 ? totalCpu : 12;
    const parsedMem = totalMemKi > 0 ? parseFloat((totalMemKi / (1024 * 1024)).toFixed(1)) : 14.8;

    const newRawNodes: Node[] = [];

    snapshotIngresses.forEach((ing) => {
      const name = String(ing.name || ing.id || "");
      if (!name) return;
      newRawNodes.push({
        id: `ingress-${name}`,
        type: "k8sIngress",
        position: { x: 100, y: 150 },
        data: {
          name,
          namespace: String(ing.namespace || "default"),
          ingressClassName: String(ing.ingressClassName || "nginx"),
          rules: (ing.rules as unknown[]) || [],
          tls: (ing.tls as unknown[]) || [],
          loadBalancerIps: (ing.loadBalancerIps as string[]) || ["127.0.0.1"],
          ...ing,
        } as K8sIngressData,
      });
    });

    snapshotServices.forEach((svc) => {
      const name = String(svc.name || svc.id || "");
      if (!name) return;
      newRawNodes.push({
        id: `service-${name}`,
        type: "k8sService",
        position: { x: 350, y: 150 },
        data: {
          name,
          type: String(svc.type || "ClusterIP"),
          port: String(svc.port || ":8080"),
          selector: svc.selector as Record<string, string>,
          ...svc,
        } as K8sServiceData,
      });
    });

    snapshotNodes.forEach((n) => {
      const name = String(n.name || n.id || "");
      if (!name) return;
      newRawNodes.push({
        id: `node-${name}`,
        type: "k8sWorker",
        position: { x: 200, y: 150 },
        data: {
          name,
          status: String(n.status || "Ready"),
          cpuPct: Number(n.cpuPct ?? 30),
          memoryPct: Number(n.memoryPct ?? 45),
          ...n,
        } as K8sNodeData,
      });
    });

    snapshotPods.forEach((p) => {
      const name = String(p.name || p.id || "");
      if (!name) return;
      const resolvedStatus = String(p.phase || p.status || "Running");
      newRawNodes.push({
        id: `pod-${name}`,
        type: "k8sPod",
        position: { x: 550, y: 150 },
        data: {
          name,
          namespace: String(p.namespace || "default"),
          status: resolvedStatus,
          phase: resolvedStatus,
          restarts: Number(p.restarts ?? p.restartCount ?? 0),
          ip: String(p.ip || p.podIP || "10.244.0.10"),
          cpuUsage: String(p.cpuUsage || "20 mcores"),
          memoryUsage: String(p.memoryUsage || "90 MiB"),
          labels: p.labels as Record<string, string>,
          ...p,
        } as K8sPodData,
      });
    });

    const snapshotRS = Array.isArray(payloadData.replicaSets) ? (payloadData.replicaSets as K8sReplicaSetData[]) : [];
    const snapshotDeployments = Array.isArray(payloadData.deployments) ? (payloadData.deployments as K8sDeploymentData[]) : [];

    set({
      rawNodes: newRawNodes,
      clusterCpuCores: parsedCpu,
      clusterMemoryGB: parsedMem,
      services: extractServices(newRawNodes),
      pods: extractPods(newRawNodes),
      ingresses: (newRawNodes.filter((n) => n.type === "k8sIngress").map((n) => n.data) as K8sIngressData[]),
      replicaSets: snapshotRS,
      deployments: snapshotDeployments,
    });
    state.applyDagreLayout();
  } else if (
    eventType === "EVENT_POD_MUTATED" ||
    eventType === "EVENT_POD_STATUS_CHANGED" ||
    eventType === "EVENT_POD_ADDED" ||
    eventType === "EVENT_POD_MODIFIED"
  ) {
    const podName = String(payloadData.name || payloadData.podName || payloadData.id || "");
    if (!podName) return;
    const resolvedStatus = String(payloadData.phase || payloadData.status || "Running");

    const idx = currentRaw.findIndex(
      (n) => n.id === podName || n.id === `pod-${podName}` || (n.data as K8sPodData)?.name === podName
    );

    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      const existingPod = existing.data as K8sPodData;
      const restartVal = Number(payloadData.restartCount ?? payloadData.restarts ?? existingPod.restarts ?? 0);
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: {
          ...existingPod,
          ...payloadData,
          name: podName,
          status: resolvedStatus,
          phase: resolvedStatus,
          restarts: restartVal,
        },
      };
    } else {
      const newPodNode: Node = {
        id: `pod-${podName}`,
        type: "k8sPod",
        position: { x: 550, y: 150 },
        data: {
          name: podName,
          namespace: String(payloadData.namespace || "default"),
          status: resolvedStatus,
          phase: resolvedStatus,
          restarts: Number(payloadData.restarts ?? payloadData.restartCount ?? 0),
          ip: String(payloadData.ip || payloadData.podIP || "10.244.0.10"),
          cpuUsage: String(payloadData.cpuUsage || "20 mcores"),
          memoryUsage: String(payloadData.memoryUsage || "90 MiB"),
          labels: payloadData.labels as Record<string, string>,
          ...payloadData,
        } as K8sPodData,
      };
      updatedRaw = [...currentRaw, newPodNode];
    }

    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_POD_DELETED") {
    const podName = String(payloadData.name || payloadData.podName || payloadData.id || "");
    if (!podName) return;

    const updatedRaw = currentRaw.filter((n) => {
      if (n.id === podName || n.id === `pod-${podName}`) return false;
      const d = n.data as Record<string, unknown> | undefined;
      return d?.name !== podName;
    });

    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
  } else if (
    eventType === "EVENT_NODE_MUTATED" ||
    eventType === "EVENT_NODE_STATUS_CHANGED" ||
    eventType === "EVENT_NODE_ADDED" ||
    eventType === "EVENT_NODE_MODIFIED"
  ) {
    const nodeName = String(payloadData.name || payloadData.nodeName || payloadData.id || "");
    if (!nodeName) return;

    const idx = currentRaw.findIndex(
      (n) => n.id === nodeName || n.id === `node-${nodeName}` || (n.data as K8sNodeData)?.name === nodeName
    );

    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: { ...(existing.data as K8sNodeData), ...payloadData, name: nodeName },
      };
    } else {
      const newNode: Node = {
        id: `node-${nodeName}`,
        type: "k8sWorker",
        position: { x: 200, y: 150 },
        data: {
          name: nodeName,
          status: String(payloadData.status || "Ready"),
          cpuPct: Number(payloadData.cpuPct ?? 30),
          memoryPct: Number(payloadData.memoryPct ?? 45),
          ...payloadData,
        } as K8sNodeData,
      };
      updatedRaw = [...currentRaw, newNode];
    }

    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
  } else if (
    eventType === "EVENT_SERVICE_MUTATED" ||
    eventType === "EVENT_SERVICE_ADDED" ||
    eventType === "EVENT_SERVICE_MODIFIED"
  ) {
    const svcName = String(payloadData.name || payloadData.serviceName || payloadData.id || "");
    if (!svcName) return;

    const idx = currentRaw.findIndex(
      (n) => n.id === svcName || n.id === `service-${svcName}` || (n.data as K8sServiceData)?.name === svcName
    );

    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: { ...(existing.data as K8sServiceData), ...payloadData, name: svcName },
      };
    } else {
      const newSvc: Node = {
        id: `service-${svcName}`,
        type: "k8sService",
        position: { x: 350, y: 150 },
        data: {
          name: svcName,
          type: String(payloadData.type || "ClusterIP"),
          port: String(payloadData.port || ":8080"),
          selector: payloadData.selector as Record<string, string>,
          ...payloadData,
        } as K8sServiceData,
      };
      updatedRaw = [...currentRaw, newSvc];
    }

    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
  } else if (
    eventType === "EVENT_INGRESS_MUTATED" ||
    eventType === "EVENT_INGRESS_ADDED" ||
    eventType === "EVENT_INGRESS_MODIFIED"
  ) {
    const ingName = String(payloadData.name || payloadData.ingressName || payloadData.id || "");
    if (!ingName) return;

    const idx = currentRaw.findIndex(
      (n) => n.id === ingName || n.id === `ingress-${ingName}` || (n.data as K8sIngressData)?.name === ingName
    );

    let updatedRaw: Node[];
    if (idx >= 0) {
      const existing = currentRaw[idx];
      updatedRaw = [...currentRaw];
      updatedRaw[idx] = {
        ...existing,
        data: { ...(existing.data as K8sIngressData), ...payloadData, name: ingName },
      };
    } else {
      const newIng: Node = {
        id: `ingress-${ingName}`,
        type: "k8sIngress",
        position: { x: 100, y: 150 },
        data: {
          name: ingName,
          namespace: String(payloadData.namespace || "default"),
          ingressClassName: String(payloadData.ingressClassName || "nginx"),
          rules: (payloadData.rules as unknown[]) || [],
          tls: (payloadData.tls as unknown[]) || [],
          loadBalancerIps: (payloadData.loadBalancerIps as string[]) || ["127.0.0.1"],
          ...payloadData,
        } as K8sIngressData,
      };
      updatedRaw = [...currentRaw, newIng];
    }

    set({
      rawNodes: updatedRaw,
      services: extractServices(updatedRaw),
      pods: extractPods(updatedRaw),
      ingresses: (updatedRaw.filter((n) => n.type === "k8sIngress").map((n) => n.data) as K8sIngressData[]),
      selectedNode: syncSelectedNode(updatedRaw, state.selectedNode),
    });
    state.applyDagreLayout();
  } else if (
    eventType === "EVENT_REPLICA_SET_MUTATED" ||
    eventType === "EVENT_REPLICA_SET_ADDED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return;
    const currentRS = state.replicaSets || [];
    const idx = currentRS.findIndex((r) => r.name === name);
    let updatedRS: K8sReplicaSetData[];
    const newItem: K8sReplicaSetData = {
      name,
      namespace: String(payloadData.namespace || "default"),
      replicas: Number(payloadData.replicas ?? 0),
      readyReplicas: Number(payloadData.readyReplicas ?? 0),
      ownerUid: payloadData.ownerUid ? String(payloadData.ownerUid) : undefined,
      ownerName: payloadData.ownerName ? String(payloadData.ownerName) : undefined,
      ownerKind: payloadData.ownerKind ? String(payloadData.ownerKind) : undefined,
      labels: payloadData.labels as Record<string, string>,
      revision: payloadData.revision ? String(payloadData.revision) : undefined,
      images: payloadData.images as string[],
      createdAt: payloadData.createdAt ? String(payloadData.createdAt) : undefined,
    };
    if (idx >= 0) {
      updatedRS = [...currentRS];
      updatedRS[idx] = { ...updatedRS[idx], ...newItem };
    } else {
      updatedRS = [...currentRS, newItem];
    }
    set({ replicaSets: updatedRS });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_REPLICA_SET_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return;
    const currentRS = state.replicaSets || [];
    const updatedRS = currentRS.filter((r) => r.name !== name);
    set({ replicaSets: updatedRS });
    state.applyDagreLayout();
  } else if (
    eventType === "EVENT_DEPLOYMENT_MUTATED" ||
    eventType === "EVENT_DEPLOYMENT_ADDED"
  ) {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return;
    const currentDeps = state.deployments || [];
    const idx = currentDeps.findIndex((d) => d.name === name);
    let updatedDeps: K8sDeploymentData[];
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
      updatedDeps = [...currentDeps];
      updatedDeps[idx] = { ...updatedDeps[idx], ...newItem };
    } else {
      updatedDeps = [...currentDeps, newItem];
    }
    set({ deployments: updatedDeps });
    state.applyDagreLayout();
  } else if (eventType === "EVENT_DEPLOYMENT_DELETED") {
    const name = String(payloadData.name || payloadData.id || "");
    if (!name) return;
    const currentDeps = state.deployments || [];
    const updatedDeps = currentDeps.filter((d) => d.name !== name);
    set({ deployments: updatedDeps });
    state.applyDagreLayout();
  }
}
