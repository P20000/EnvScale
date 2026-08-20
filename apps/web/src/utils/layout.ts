import dagre from "@dagrejs/dagre";
import { Position, type Node, type Edge } from "@xyflow/react";
import type { K8sPodData } from "../components/canvas/K8sPod";

/**
 * Calculates dynamic hierarchical layout using Dagre:
 * Ingress Gateway -> Service -> Pod -> Worker Node
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  if (!nodes || nodes.length === 0) return { nodes, edges };

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 100,
    marginx: 50,
    marginy: 50,
  });

  // Set nodes with exact UI component dimensions
  nodes.forEach((node) => {
    let width = 280;
    let height = 110;

    if (node.type === "k8sWorker") {
      width = 360;
      height = 210;
    } else if (node.type === "k8sService") {
      width = 250;
      height = 75;
    } else if (node.type === "k8sIngress") {
      width = 280;
      height = 130;
    } else if (node.type === "k8sPod") {
      width = 280;
      height = 110;
    } else if (
      node.type === "k8sDeployment" ||
      node.type === "k8sReplicaSet" ||
      node.type === "k8sStatefulSet"
    ) {
      width = 280;
      height = 100;
    }

    dagreGraph.setNode(node.id, { width, height });
  });

  const nodeMap = new Map<string, Node>(nodes.map((n) => [n.id, n]));

  // Add edges to Dagre graph with explicit rank constraints
  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode || !targetNode) {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 });
      return;
    }

    // Ignore direct Service -> Worker Node edges (architectural anti-pattern)
    if (
      (sourceNode.type === "k8sService" && targetNode.type === "k8sWorker") ||
      (sourceNode.type === "k8sWorker" && targetNode.type === "k8sService")
    ) {
      return;
    }

    // Ingress -> Service
    if (sourceNode.type === "k8sIngress" && targetNode.type === "k8sService") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 6 });
      return;
    }

    // Service -> Service (e.g. Ingress Gateway if modeled as Service, fallback)
    if (sourceNode.type === "k8sService" && targetNode.type === "k8sService") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 5 });
      return;
    }

    // Service -> Workload
    if (
      sourceNode.type === "k8sService" &&
      (targetNode.type === "k8sDeployment" || targetNode.type === "k8sStatefulSet")
    ) {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 4 });
      return;
    }

    // Workload -> Workload (Deployment -> ReplicaSet)
    if (sourceNode.type === "k8sDeployment" && targetNode.type === "k8sReplicaSet") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 3 });
      return;
    }

    // Service -> Pod (Fallback)
    if (sourceNode.type === "k8sService" && targetNode.type === "k8sPod") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 });
      return;
    }

    // Workload -> Pod
    if (
      (sourceNode.type === "k8sReplicaSet" || sourceNode.type === "k8sStatefulSet") &&
      targetNode.type === "k8sPod"
    ) {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 });
      return;
    }

    // Pod -> Worker Node (Hosting connection)
    if (sourceNode.type === "k8sPod" && targetNode.type === "k8sWorker") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 });
      return;
    }

    // Worker Node -> Pod (Reversed hosting connection - align direction)
    if (sourceNode.type === "k8sWorker" && targetNode.type === "k8sPod") {
      dagreGraph.setEdge(targetNode.id, sourceNode.id, { minlen: 1, weight: 2 });
      return;
    }

    // Default edge handling
    dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 });
  });

  // Link Pods to their host Worker Nodes via metadata if explicit edge is missing in graph
  nodes.forEach((node) => {
    if (node.type === "k8sPod") {
      const podData = node.data as K8sPodData;
      if (podData?.nodeName) {
        const matchingWorker = nodes.find(
          (n) => n.type === "k8sWorker" && (n.data as { name?: string })?.name === podData.nodeName
        );
        if (
          matchingWorker &&
          !dagreGraph.hasEdge(node.id, matchingWorker.id) &&
          !dagreGraph.hasEdge(matchingWorker.id, node.id)
        ) {
          dagreGraph.setEdge(node.id, matchingWorker.id, { minlen: 1, weight: 2 });
        }
      }
    }
  });

  dagre.layout(dagreGraph);

  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (!nodeWithPosition) return node;

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: Math.round(nodeWithPosition.x - nodeWithPosition.width / 2),
        y: Math.round(nodeWithPosition.y - nodeWithPosition.height / 2),
      },
    };
  });

  const layoutedEdges: Edge[] = edges.map((edge) => {
    return {
      ...edge,
      sourceHandle: isHorizontal ? "right-source" : "bottom-source",
      targetHandle: isHorizontal ? "left-target" : "top-target",
    };
  });

  return { nodes: layoutedNodes, edges: layoutedEdges };
}

