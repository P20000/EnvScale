import dagre from '@dagrejs/dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ 
    rankdir: direction, 
    nodesep: 40, 
    ranksep: 160, // Expanded for cleaner macro-routing
    marginx: 40,
    marginy: 40
  });

  const parentNodes = nodes.filter((n) => n.type === "k8sGroup");
  const childNodes = nodes.filter((n) => n.parentId);
  const otherNodes = nodes.filter((n) => n.type !== "k8sGroup" && !n.parentId);

  // 1. Calculate and set dimensions for Parent Groups based on their children
  parentNodes.forEach((parent) => {
    const children = childNodes.filter(c => c.parentId === parent.id);
    const numChildren = children.length || 1;
    
    // Grid Math: max 2 columns, width 208px, height 32px, gap 10px, padding 16px, header offset 40px
    const cols = Math.min(numChildren, 2);
    const rows = Math.ceil(numChildren / 2);
    
    const width = Math.max(280, 16 * 2 + cols * 208 + (cols - 1) * 10);
    const height = Math.max(80, 40 + rows * 32 + (rows - 1) * 10 + 16);

    parent.style = { ...parent.style, width, height };
    
    dagreGraph.setNode(parent.id, { width, height });
  });

  // 2. Set dimensions for standard macroscopic nodes (Services, Ingress, etc)
  otherNodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 240, height: 44 });
  });

  // Note: childNodes are intentionally NOT added to Dagre since they have relative positions

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    if (node.parentId) {
      // Child nodes keep their relative positions inside the parent boundary
      return {
        ...node,
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
      };
    }

    const nodeWithPosition = dagreGraph.node(node.id);
    const w = nodeWithPosition.width;
    const h = nodeWithPosition.height;

    return {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: {
        x: nodeWithPosition.x - w / 2,
        y: nodeWithPosition.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};
