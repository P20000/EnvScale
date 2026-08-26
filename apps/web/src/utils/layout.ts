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
        const rightX = gNode.x + gNode.width / 2;
        const topY = gNode.y - gNode.height / 2;
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
        const rightX = gNode.x + gNode.width / 2;
        const topY = gNode.y - gNode.height / 2;
        if (rightX > dagreMaxX) dagreMaxX = rightX;
        if (topY < dagreMinY) dagreMinY = topY;
      }
    });
  }

  const dockStartX = dagreMaxX + 80;
  const dockStartY = Math.max(dagreMinY, 40);

  const isTB = direction === "TB";
  const targetPos = isTB ? Position.Top : Position.Left;
  const sourcePos = isTB ? Position.Bottom : Position.Right;

  // Track orphan vertical stack accumulation
  let currentOrphanY = dockStartY;

  const layoutedNodes = nodes.map((node) => {
    if (node.parentId) {
      // Child nodes keep relative position inside group boundary
      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
      };
    }

    const isOrphan = isTB && !connectedIds.has(node.id);
    if (isOrphan) {
      const dims = getNodeDimensions(node);
      const pos = {
        x: dockStartX,
        y: currentOrphanY,
      };
      currentOrphanY += dims.height + 24;

      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
        position: pos,
      };
    }

    const nodeWithPosition = dagreGraph.node(node.id);
    const w = nodeWithPosition ? nodeWithPosition.width : 240;
    const h = nodeWithPosition ? nodeWithPosition.height : 44;

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
