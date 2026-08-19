import dagre from "@dagrejs/dagre";
import { Position, type Node, type Edge } from "@xyflow/react";

/**
 * Calculates hierarchical layout using Dagre:
 * Hierarchy: K8sNode (Worker) -> K8sService -> K8sPod
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
  });

  nodes.forEach((node) => {
    // Determine dimensions based on Kubernetes custom node type
    let width = 220;
    let height = 120;

    if (node.type === "k8sPod") {
      width = 190;
      height = 85;
    } else if (node.type === "k8sService") {
      width = 210;
      height = 95;
    } else if (node.type === "k8sWorker") {
      width = 240;
      height = 130;
    }

    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);

    let width = 220;
    let height = 120;
    if (node.type === "k8sPod") {
      width = 190;
      height = 85;
    } else if (node.type === "k8sService") {
      width = 210;
      height = 95;
    } else if (node.type === "k8sWorker") {
      width = 240;
      height = 130;
    }

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
