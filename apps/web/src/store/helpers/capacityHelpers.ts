import type { Node } from "@xyflow/react";
import type { K8sNodeData } from "../../components/canvas/K8sNode";

export function parseK8sCpuCapacity(cpuStr?: string): number {
  if (!cpuStr) return 0;
  const str = cpuStr.trim();
  if (str.endsWith("m")) {
    const val = parseFloat(str.slice(0, -1));
    return isNaN(val) ? 0 : val / 1000;
  }
  const val = parseFloat(str);
  return isNaN(val) ? 0 : val;
}

export function parseK8sMemoryCapacity(memStr?: string): number {
  if (!memStr) return 0;
  const str = memStr.trim();
  if (str.endsWith("Ki") || str.endsWith("ki")) {
    const ki = parseFloat(str.slice(0, -2));
    return isNaN(ki) ? 0 : ki / (1024 * 1024);
  }
  if (str.endsWith("Mi") || str.endsWith("mi")) {
    const mi = parseFloat(str.slice(0, -2));
    return isNaN(mi) ? 0 : mi / 1024;
  }
  if (str.endsWith("Gi") || str.endsWith("gi")) {
    const gi = parseFloat(str.slice(0, -2));
    return isNaN(gi) ? 0 : gi;
  }
  if (str.endsWith("Ti") || str.endsWith("ti")) {
    const ti = parseFloat(str.slice(0, -2));
    return isNaN(ti) ? 0 : ti * 1024;
  }
  if (str.endsWith("K") || str.endsWith("k")) {
    const k = parseFloat(str.slice(0, -1));
    return isNaN(k) ? 0 : (k * 1000) / (1024 * 1024 * 1024);
  }
  if (str.endsWith("M") || str.endsWith("m")) {
    const m = parseFloat(str.slice(0, -1));
    return isNaN(m) ? 0 : (m * 1000 * 1000) / (1024 * 1024 * 1024);
  }
  if (str.endsWith("G") || str.endsWith("g")) {
    const g = parseFloat(str.slice(0, -1));
    return isNaN(g) ? 0 : (g * 1000 * 1000 * 1000) / (1024 * 1024 * 1024);
  }
  const bytes = parseFloat(str);
  if (!isNaN(bytes) && bytes > 0) {
    return bytes / (1024 * 1024 * 1024);
  }
  return 0;
}

export function calculateClusterCapacity(nodes: Node[]): { clusterCpuCores: number; clusterMemoryGB: number } {
  let totalCpu = 0;
  let totalMemGB = 0;
  for (const n of nodes) {
    if (n.type === "k8sWorker" && n.data) {
      const data = n.data as K8sNodeData;
      totalCpu += parseK8sCpuCapacity(data.cpuCapacity);
      totalMemGB += parseK8sMemoryCapacity(data.memoryCapacity);
    }
  }
  return {
    clusterCpuCores: totalCpu,
    clusterMemoryGB: parseFloat(totalMemGB.toFixed(1)),
  };
}
