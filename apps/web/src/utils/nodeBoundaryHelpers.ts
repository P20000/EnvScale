import type { Node } from "@xyflow/react";
import type { K8sPodData } from "../components/canvas/K8sPod";
import type { K8sNodeData } from "../components/canvas/K8sNode";

export interface NodeMetadata {
  zone: string;
  region: string;
  instanceType: string;
  role: "control-plane" | "worker";
}

export interface K8sNodeBoundaryData extends Record<string, unknown> {
  nodeName: string;
  zone: string;
  region: string;
  instanceType: string;
  role: "control-plane" | "worker";
  status: string;
  cpuPct: number;
  memoryPct: number;
  podCount: number;
  podCapacity: number;
  daemonAgents?: Array<{ name: string; ready: boolean }>;
  workloadNames: string[];
}

export interface WorkloadNodePlacement {
  isMultiNode: boolean;
  primaryNode: string;
  nodes: string[];
  zones: string[];
}

/**
 * Formats lengthy Kubernetes node names / cloud internal hostnames into clean, human-readable labels.
 * E.g., "ip-10-100-2-229.ap-south-1.compute.internal" -> "ip-10-100-2-229"
 * E.g., "ip-172-31-0-12.ec2.internal" -> "ip-172-31-0-12"
 * E.g., "gke-cluster-pool-1-abc123-xyz.c.project.internal" -> "gke-cluster-pool-1-abc123-xyz"
 */
export function formatNodeName(nodeName?: string): string {
  if (!nodeName) return "";
  const clean = nodeName.trim();
  return clean.replace(/\.(ec2\.internal|[a-z0-9-]+\.compute\.internal|compute\.internal|[a-z0-9-]+\.internal|internal)$/i, "");
}

/**
 * Extracts cloud zone, region, instance type, and role from standard Kubernetes node labels.
 */
export function extractNodeMetadata(labels?: Record<string, string>): NodeMetadata {
  if (!labels) {
    return {
      zone: "local-zone",
      region: "local",
      instanceType: "standard",
      role: "worker",
    };
  }

  const zone =
    labels["topology.kubernetes.io/zone"] ||
    labels["failure-domain.beta.kubernetes.io/zone"] ||
    labels["topology.eks.amazonaws.com/zone"] ||
    "local-zone";

  const region =
    labels["topology.kubernetes.io/region"] ||
    labels["failure-domain.beta.kubernetes.io/region"] ||
    "local";

  const instanceType =
    labels["node.kubernetes.io/instance-type"] ||
    labels["beta.kubernetes.io/instance-type"] ||
    labels["instance-type"] ||
    "standard";

  const isControlPlane =
    labels["node-role.kubernetes.io/control-plane"] !== undefined ||
    labels["node-role.kubernetes.io/master"] !== undefined;

  return {
    zone,
    region,
    instanceType,
    role: isControlPlane ? "control-plane" : "worker",
  };
}

/**
 * Calculates whether a workload is single-node or distributed across multiple nodes/zones.
 */
export function getWorkloadNodePlacement(
  pods: Array<{ nodeName?: string }>,
  nodeMetaMap?: Map<string, NodeMetadata>
): WorkloadNodePlacement {
  const nodeSet = new Set<string>();
  pods.forEach((p) => {
    if (p.nodeName) {
      nodeSet.add(p.nodeName);
    }
  });

  const nodes = Array.from(nodeSet);
  const primaryNode = nodes[0] || "unassigned";
  const isMultiNode = nodes.length > 1;

  const zoneSet = new Set<string>();
  nodes.forEach((nName) => {
    const meta = nodeMetaMap?.get(nName);
    if (meta?.zone) {
      zoneSet.add(meta.zone);
    }
  });

  return {
    isMultiNode,
    primaryNode,
    nodes,
    zones: Array.from(zoneSet),
  };
}

const getNodeDimensions = (node: Node) => {
  if (node.type === "k8sStatefulSet") {
    const data = node.data as { replicas?: number; pods?: unknown[] };
    const count = Math.max(data?.replicas || 0, (data?.pods || []).length, 1);
    const width = Math.max(260, count * 125 + 20);
    return { width, height: 132 };
  }
  if (node.type === "k8sGroup") {
    return { width: 295, height: 90 };
  }
  if (node.type === "k8sPVC") {
    return { width: 200, height: 70 };
  }
  if (node.type === "k8sWorker") {
    return { width: 260, height: 56 };
  }
  return { width: 260, height: 56 };
};

/**
 * Calculates bounding boxes on the canvas for each worker node enclosing its scheduled workloads.
 */
export function calculateNodeBoundaries(
  canvasNodes: Node[],
  workerNodes: Node[]
): Node[] {
  // Build lookup of node metadata
  const nodeMetaMap = new Map<string, NodeMetadata>();
  const workerDataMap = new Map<string, K8sNodeData>();

  workerNodes.forEach((wn) => {
    const d = wn.data as K8sNodeData;
    const name = d.name || wn.id.replace(/^node-/, "");
    workerDataMap.set(name, d);
    nodeMetaMap.set(name, extractNodeMetadata(d.labels as Record<string, string>));
  });

  // Map each canvas node to its host worker node(s)
  const nodeWorkloadsMap = new Map<string, Node[]>();

  canvasNodes.forEach((node) => {
    // Skip dock nodes, boundaries, or side-rail utility cards
    if (
      node.type === "k8sWorker" ||
      node.type === "k8sNodeBoundary" ||
      node.type === "k8sCompletedJobs" ||
      node.type === "k8sIngress"
    ) {
      return;
    }

    const data = node.data as Record<string, unknown> | undefined;
    if (!data) return;

    let targetNodeNames: string[] = [];

    if (node.type === "k8sGroup" || node.type === "k8sStatefulSet") {
      const pods = (data.pods || []) as K8sPodData[];
      const names = Array.from(new Set(pods.map((p) => p.nodeName).filter(Boolean))) as string[];
      targetNodeNames = names.length > 0 ? names : [];
    } else if (node.type === "k8sPod") {
      const pData = data as unknown as K8sPodData;
      if (pData.nodeName) targetNodeNames = [pData.nodeName];
    } else if (data.nodeName && typeof data.nodeName === "string") {
      targetNodeNames = [data.nodeName];
    }

    // Default to the first known worker if not yet set
    if (targetNodeNames.length === 0 && workerNodes.length > 0) {
      const firstWorker = (workerNodes[0].data as K8sNodeData)?.name || workerNodes[0].id.replace(/^node-/, "");
      targetNodeNames = [firstWorker];
    }

    targetNodeNames.forEach((nName) => {
      const list = nodeWorkloadsMap.get(nName) || [];
      list.push(node);
      nodeWorkloadsMap.set(nName, list);
    });
  });

  const PADDING_X = 28;
  const PADDING_TOP = 52; // room for top node metadata header
  const PADDING_BOTTOM = 24;

  const boundaryNodes: Node[] = [];

  // Determine all distinct nodes to render boundaries for
  const allNodeNames = Array.from(
    new Set([...workerDataMap.keys(), ...nodeWorkloadsMap.keys()])
  );

  allNodeNames.forEach((nodeName) => {
    const assignedNodes = nodeWorkloadsMap.get(nodeName) || [];
    const workerData = workerDataMap.get(nodeName);
    const meta = nodeMetaMap.get(nodeName) || extractNodeMetadata(workerData?.labels as Record<string, string>);

    if (assignedNodes.length === 0) {
      return;
    }

    // Calculate bounding box across assigned nodes
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    assignedNodes.forEach((n) => {
      const pos = n.position || { x: 0, y: 0 };
      const dims = getNodeDimensions(n);
      const left = pos.x;
      const right = pos.x + dims.width;
      const top = pos.y;
      const bottom = pos.y + dims.height;

      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });

    if (minX === Infinity || minY === Infinity) {
      return;
    }

    const boxX = minX - PADDING_X;
    const boxY = minY - PADDING_TOP;
    const boxWidth = Math.max(340, maxX - minX + PADDING_X * 2);
    const boxHeight = maxY - minY + PADDING_TOP + PADDING_BOTTOM;

    const workloadNames = assignedNodes
      .map((n) => (n.data as { name?: string })?.name || n.id)
      .filter(Boolean);

    const boundaryData: K8sNodeBoundaryData = {
      nodeName,
      zone: meta.zone,
      region: meta.region,
      instanceType: meta.instanceType,
      role: meta.role,
      status: workerData?.status || "Ready",
      cpuPct: workerData?.cpuPct ?? 0,
      memoryPct: workerData?.memoryPct ?? 0,
      podCount: assignedNodes.length,
      podCapacity: (workerData?.podCapacity as number) || 110,
      daemonAgents: workerData?.daemonAgents,
      workloadNames,
    };

    boundaryNodes.push({
      id: `boundary-${nodeName}`,
      type: "k8sNodeBoundary",
      position: { x: boxX, y: boxY },
      style: {
        width: boxWidth,
        height: boxHeight,
        zIndex: -1,
      },
      selectable: false,
      draggable: false,
      data: boundaryData,
    });
  });

  return boundaryNodes;
}
