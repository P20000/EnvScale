import type { Node } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sNodeData } from "../../components/canvas/K8sNode";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData } from "../../components/canvas/K8sIngress";

export function parseClusterMetrics(snapshotNodes: Record<string, unknown>[]): {
  parsedCpu: number;
  parsedMem: number;
} {
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
  return { parsedCpu, parsedMem };
}

export function parseCoreSnapshotNodes(
  snapshotIngresses: Record<string, unknown>[],
  snapshotServices: Record<string, unknown>[],
  snapshotNodes: Record<string, unknown>[],
  snapshotPods: Record<string, unknown>[]
): Node[] {
  const nodes: Node[] = [];

  snapshotIngresses.forEach((ing) => {
    const name = String(ing.name || ing.id || "");
    if (!name) return;
    nodes.push({
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
    nodes.push({
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
    nodes.push({
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
    nodes.push({
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

  return nodes;
}
