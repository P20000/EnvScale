import dagre from '@dagrejs/dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  });

  const parentNodes = nodes.filter((n) => n.type === "k8sGroup");
  const childNodes = nodes.filter((n) => n.parentId);
  const otherNodes = nodes.filter((n) => n.type !== "k8sGroup" && !n.parentId);

  // Helper to determine node dimensions
  const getNodeDimensions = (node: Node) => {
    if (node.type === "k8sGroup") {
      const children = childNodes.filter((c) => c.parentId === node.id);
      const numChildren = children.length || 1;
      const cols = Math.min(numChildren, 2);
      const rows = Math.ceil(numChildren / 2);
      const width = Math.max(280, 16 * 2 + cols * 208 + (cols - 1) * 10);
      const height = Math.max(80, 40 + rows * 32 + (rows - 1) * 10 + 16);
      return { width, height };
    }
    if (node.type === "k8sDaemonSet" || node.type === "k8sCronJob" || node.type === "k8sJob") {
      return { width: 260, height: 58 };
    }
    if (node.type === "k8sCompletedJobs") {
      return { width: 260, height: 48 };
    }
    return { width: 240, height: 44 };
  };

  // Find set of connected node IDs (including parents of connected children)
  const connectedIds = new Set<string>();
  edges.forEach((e) => {
    connectedIds.add(e.source);
    connectedIds.add(e.target);

    // If child is connected, mark parent group as connected too
    const sourceNode = nodes.find((n) => n.id === e.source);
    if (sourceNode?.parentId) connectedIds.add(sourceNode.parentId);

    const targetNode = nodes.find((n) => n.id === e.target);
    if (targetNode?.parentId) connectedIds.add(targetNode.parentId);
  });

  const topLevelNodes = [...parentNodes, ...otherNodes];
  const connectedTopLevel = topLevelNodes.filter((n) => connectedIds.has(n.id));

  // Add ONLY connected top-level nodes to dagre graph for layout math
  connectedTopLevel.forEach((node) => {
    const { width, height } = getNodeDimensions(node);
    if (node.type === "k8sGroup") {
      node.style = { ...node.style, width, height };
    }
    dagreGraph.setNode(node.id, { width, height });
  });

  // Ensure orphan group nodes get proper dimensions set in style
  topLevelNodes.forEach((node) => {
    if (!connectedIds.has(node.id) && node.type === "k8sGroup") {
      const { width, height } = getNodeDimensions(node);
      node.style = { ...node.style, width, height };
    }
  });

  edges.forEach((edge) => {
    if (connectedIds.has(edge.source) || connectedIds.has(edge.target)) {
      dagreGraph.setEdge(edge.source, edge.target);
    }
  });

  if (connectedTopLevel.length > 0) {
    dagre.layout(dagreGraph);
  }

  // Compute bounding box strictly across connected top-level nodes
  let dagreMaxX = 300;
  let dagreMinY = 40;

  if (connectedTopLevel.length > 0) {
    let maxX = -Infinity;
    let minY = Infinity;
    connectedTopLevel.forEach((n) => {
      const gNode = dagreGraph.node(n.id);
      if (gNode) {
        const dims = getNodeDimensions(n);
        const w = gNode.width ?? dims.width;
        const h = gNode.height ?? dims.height;
        const rightX = gNode.x + w / 2;
        const topY = gNode.y - h / 2;
        if (rightX > maxX) maxX = rightX;
        if (topY < minY) minY = topY;
      }
    });
    if (maxX !== -Infinity) dagreMaxX = maxX;
    if (minY !== Infinity) dagreMinY = minY;
  } else {
    topLevelNodes.forEach((n) => {
      const gNode = dagreGraph.node(n.id);
      if (gNode) {
        const dims = getNodeDimensions(n);
        const w = gNode.width ?? dims.width;
        const h = gNode.height ?? dims.height;
        const rightX = gNode.x + w / 2;
        const topY = gNode.y - h / 2;
        if (rightX > dagreMaxX) dagreMaxX = rightX;
        if (topY < dagreMinY) dagreMinY = topY;
      }
    });
  }

  const MIN_SIDE_RAIL_X = 1100;
  // Dynamic offset: always placed to the right of the widest Dagre node
  // In TB mode (or narrow graphs), preserve at least MIN_SIDE_RAIL_X margin
  const dockStartX = connectedTopLevel.length > 0
    ? Math.max(dagreMaxX + 160, MIN_SIDE_RAIL_X)
    : 40;
  const dockStartY = Math.max(dagreMinY, 40);

  const isTB = direction === "TB";
  const targetPos = isTB ? Position.Top : Position.Left;
  const sourcePos = isTB ? Position.Bottom : Position.Right;

  const isOrphanNode = (node: Node): boolean => {
    if (node.parentId) return false;
    if (node.type === "k8sDaemonSet" || node.type === "k8sCronJob" || node.type === "k8sJob" || node.type === "k8sCompletedJobs") return true;
    return !connectedIds.has(node.id);
  };

  const getOrphanTier = (node: Node): number => {
    if (node.type === "k8sWorker") return 1;     // Host Node (e.g. minikube)
    if (node.type === "k8sGroup") return 2;      // Unrouted Workload Group (e.g. WORKER-POOL)
    if (node.type === "k8sDaemonSet") return 3;  // DaemonSets (e.g. node-telemetry-agent)
    if (node.type === "k8sCronJob") return 4;    // CronJobs (e.g. db-audit-cronjob)
    if (node.type === "k8sJob") return 5;        // Standalone batch jobs
    if (node.type === "k8sCompletedJobs") return 6; // Collapsed Completed Jobs
    return 7;                                    // Standalone unrouted workloads
  };

  const orphanNodes = topLevelNodes.filter(isOrphanNode).sort((a, b) => {
    const tierA = getOrphanTier(a);
    const tierB = getOrphanTier(b);
    if (tierA !== tierB) return tierA - tierB;
    return a.id.localeCompare(b.id);
  });

  const orphanPosMap = new Map<string, { x: number; y: number }>();
  let currentOrphanY = dockStartY;

  orphanNodes.forEach((node) => {
    const dims = getNodeDimensions(node);
    if (node.type === "k8sGroup") {
      node.style = { ...node.style, width: dims.width, height: dims.height };
    }
    orphanPosMap.set(node.id, { x: dockStartX, y: currentOrphanY });
    currentOrphanY += dims.height + 24;
  });

  const layoutedNodes = nodes.map((node) => {
    if (node.parentId) {
      // Child nodes keep relative position inside group boundary
      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
      };
    }

    if (orphanPosMap.has(node.id)) {
      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
        position: orphanPosMap.get(node.id)!,
      };
    }

    const nodeWithPosition = dagreGraph.node(node.id);
    const dims = getNodeDimensions(node);
    const w = nodeWithPosition?.width ?? dims.width;
    const h = nodeWithPosition?.height ?? dims.height;

    return {
      ...node,
      targetPosition: targetPos,
      sourcePosition: sourcePos,
      position: {
        x: (nodeWithPosition?.x ?? 0) - w / 2,
        y: (nodeWithPosition?.y ?? 0) - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};
