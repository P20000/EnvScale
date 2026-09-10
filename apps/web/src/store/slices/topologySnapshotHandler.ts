import type { Node } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sNodeData } from "../../components/canvas/K8sNode";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData } from "../../components/canvas/K8sIngress";
import type { K8sReplicaSetData, K8sDeploymentData } from "../helpers/rolloutHelpers";
import type { K8sDaemonSetData, K8sCronJobData, K8sJobData } from "../types/topologyTypes";
import type { TopologyState } from "../useTopologyStore";
import { extractServices, extractPods } from "../helpers/topologyHelpers";
import { useUIStore } from "../useUIStore";

export function handleSnapshotSync(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  payloadData: Record<string, unknown>
) {
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
        isTerminating: Boolean(p.isTerminating || resolvedStatus === "Terminating"),
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
  const snapshotDS = Array.isArray(payloadData.daemonSets) ? (payloadData.daemonSets as K8sDaemonSetData[]) : [];
  const snapshotCronJobs = Array.isArray(payloadData.cronJobs) ? (payloadData.cronJobs as K8sCronJobData[]) : [];
  const snapshotJobs = Array.isArray(payloadData.jobs) ? (payloadData.jobs as K8sJobData[]) : [];

  let updatedNamespaces = useUIStore.getState().selectedNamespaces;
  if (updatedNamespaces.length === 0) {
    const nsSet = new Set<string>();
    newRawNodes.forEach((n) => {
      const d = n.data as Record<string, unknown> | undefined;
      if (d?.namespace && typeof d.namespace === "string") {
        nsSet.add(d.namespace);
      }
    });
    const sysNs = new Set(["kube-system", "ingress-nginx", "local-path-storage", "kube-public", "kube-node-lease"]);
    const nonSys = Array.from(nsSet).filter((ns) => !sysNs.has(ns));
    updatedNamespaces = nonSys.length > 0 ? nonSys : Array.from(nsSet);
    useUIStore.getState().setSelectedNamespaces(updatedNamespaces);
  }

  set({
    rawNodes: newRawNodes,
    clusterCpuCores: parsedCpu,
    clusterMemoryGB: parsedMem,
    services: extractServices(newRawNodes),
    pods: extractPods(newRawNodes),
    ingresses: (newRawNodes.filter((n) => n.type === "k8sIngress").map((n) => n.data) as K8sIngressData[]),
    replicaSets: snapshotRS,
    deployments: snapshotDeployments,
    daemonSets: snapshotDS,
    cronJobs: snapshotCronJobs,
    jobs: snapshotJobs,
  });
  state.applyDagreLayout();
}
