import type { Node } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { TopologyState } from "../useTopologyStore";
import {
  extractServices,
  extractPods,
  syncSelectedNode,
} from "../helpers/topologyHelpers";

export function handleUpsertService(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  serviceData: Partial<K8sServiceData> & { name: string }
) {
  const name = serviceData.name;
  const current = get().rawNodes && get().rawNodes.length > 0 ? get().rawNodes : get().nodes;
  const idx = current.findIndex(
    (n) => n.id === serviceData.id || (n.data as K8sServiceData)?.name === name
  );

  let updated: Node[];
  if (idx >= 0) {
    const existing = current[idx];
    updated = [...current];
    updated[idx] = {
      ...existing,
      data: { ...(existing.data as K8sServiceData), ...serviceData },
    };
  } else {
    const newServiceNode: Node = {
      id: typeof serviceData.id === "string" ? serviceData.id : `service-${name}-${Date.now()}`,
      type: "k8sService",
      position: { x: 300, y: 150 },
      data: {
        name,
        type: serviceData.type || "ClusterIP",
        port: serviceData.port || ":8080",
      } as K8sServiceData,
    };
    updated = [...current, newServiceNode];
  }
  set({
    rawNodes: updated,
    services: extractServices(updated),
    pods: extractPods(updated),
    selectedNode: syncSelectedNode(updated, get().selectedNode),
  });
  get().applyDagreLayout();
}

export function handleUpsertPod(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  podData: Partial<K8sPodData> & { name: string }
) {
  const name = podData.name;
  const current = get().rawNodes && get().rawNodes.length > 0 ? get().rawNodes : get().nodes;
  const idx = current.findIndex(
    (n) => n.id === podData.id || (n.data as K8sPodData)?.name === name
  );

  let updated: Node[];
  if (idx >= 0) {
    const existing = current[idx];
    updated = [...current];
    updated[idx] = {
      ...existing,
      data: { ...(existing.data as K8sPodData), ...podData },
    };
  } else {
    const newPodNode: Node = {
      id: typeof podData.id === "string" ? podData.id : `pod-${name}-${Date.now()}`,
      type: "k8sPod",
      position: { x: 550, y: 150 },
      data: {
        name,
        namespace: podData.namespace || "default",
        nodeName: podData.nodeName || "minikube-worker-1",
        status: podData.status || "Running",
        restarts: podData.restarts ?? 0,
        ip: podData.ip || "10.244.0.10",
        cpuUsage: podData.cpuUsage || "30 mcores",
        memoryUsage: podData.memoryUsage || "120 MiB",
      } as K8sPodData,
    };
    updated = [...current, newPodNode];
  }
  set({
    rawNodes: updated,
    services: extractServices(updated),
    pods: extractPods(updated),
    selectedNode: syncSelectedNode(updated, get().selectedNode),
  });
  get().applyDagreLayout();
}

export function handleSetServices(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  servicesInput: K8sServiceData[] | ((prev: K8sServiceData[]) => K8sServiceData[])
) {
  const currentServices = get().services;
  const nextServices = typeof servicesInput === "function" ? servicesInput(currentServices) : servicesInput;
  const currentNodes = get().nodes;
  const nonServiceNodes = currentNodes.filter((n) => n.type !== "k8sService");
  const serviceNodes: Node[] = nextServices.map((svcData, index) => ({
    id: `svc-${svcData.name}`,
    type: "k8sService",
    position: { x: 50 + (index % 4) * 250, y: 180 },
    data: svcData,
  }));
  const updatedNodes = [...nonServiceNodes, ...serviceNodes];
  set({
    nodes: updatedNodes,
    services: nextServices,
    pods: extractPods(updatedNodes),
  });
}
