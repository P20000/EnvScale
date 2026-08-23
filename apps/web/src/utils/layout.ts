import dagre from "@dagrejs/dagre";
import { Position, type Node, type Edge } from "@xyflow/react";
import type { K8sIngressData } from "../components/canvas/K8sIngress";

/**
 * Calculates dynamic hierarchical layout using Dagre with:
 * 1. Stateless origin calculations (zero compound Y-offset accumulation)
 * 2. Dynamic bounding box heights for Ingress cards (120 + N * 34px)
 * 3. Explicit nodesep (60px) and ranksep (200px)
 * 4. Stateless 60px orphan dock offset directly below fresh connected dagreMaxY
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  if (!nodes || nodes.length === 0) return { nodes, edges };

  const isHorizontal = direction === "LR";
  const connectedNodeIds = new Set<string>();

  // 1. Collect connected node IDs from valid edges
  edges.forEach((e) => {
    if (e.source) connectedNodeIds.add(e.source);
    if (e.target) connectedNodeIds.add(e.target);
  });

  // Separate connected nodes vs orphan compute nodes
  const connectedNodes = nodes.filter((n) => connectedNodeIds.has(n.id));
  const orphanNodes = nodes.filter((n) => !connectedNodeIds.has(n.id));

  // Initialize Dagre graph ONLY for connected nodes
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 200,
    marginx: 80,
    marginy: 60,
  });

  // Set node dimensions in Dagre
  const nodesToLayout = connectedNodes.length > 0 ? connectedNodes : nodes;
  nodesToLayout.forEach((node) => {
    let width = 280;
    let height = 110;

    if (node.type === "k8sWorker") {
      width = 360;
      height = 210;
    } else if (node.type === "k8sService") {
      width = 260;
      height = 85;
    } else if (node.type === "k8sIngress") {
      width = 320;
      const ingressData = node.data as K8sIngressData;
      const rulesCount = Array.isArray(ingressData?.rules) ? ingressData.rules.length : 1;
      height = 120 + Math.max(1, rulesCount) * 34;
    } else if (node.type === "k8sPod") {
      width = 280;
      height = 120;
    } else if (
      node.type === "k8sDeployment" ||
      node.type === "k8sReplicaSet" ||
      node.type === "k8sStatefulSet" ||
      node.type === "k8sWorkload"
    ) {
      width = 280;
      height = 125;
    }

    dagreGraph.setNode(node.id, { width, height });
  });

  const nodeMap = new Map<string, Node>(nodesToLayout.map((n) => [n.id, n]));

  // Add edges to Dagre graph
  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return;

    // Ignore direct Service -> Worker Node edges
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

    // Service -> Workload
    if (
      sourceNode.type === "k8sService" &&
      (targetNode.type === "k8sDeployment" || targetNode.type === "k8sStatefulSet")
    ) {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 4 });
      return;
    }

    // Service -> Pod
    if (sourceNode.type === "k8sService" && targetNode.type === "k8sPod") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 });
      return;
    }

    // Workload -> Pod
    if (
      (sourceNode.type === "k8sReplicaSet" || sourceNode.type === "k8sStatefulSet" || sourceNode.type === "k8sDeployment") &&
      targetNode.type === "k8sPod"
    ) {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 });
      return;
    }

    // Pod -> Worker Node
    if (sourceNode.type === "k8sPod" && targetNode.type === "k8sWorker") {
      dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 });
      return;
    }

    dagreGraph.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 });
  });

  dagre.layout(dagreGraph);

  // Compute fresh stateless position coordinates for connected nodes
  const layoutedConnectedNodes: Node[] = nodesToLayout.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    if (!nodeWithPosition) return node;

    const posX = Math.round(nodeWithPosition.x - nodeWithPosition.width / 2);
    const posY = Math.round(nodeWithPosition.y - nodeWithPosition.height / 2);

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: { x: posX, y: posY },
    };
  });

  // Symmetrically align Service column nodes vertically relative to Ingress node center Y
  const ingressNodes = layoutedConnectedNodes.filter((n) => n.type === "k8sIngress");
  const serviceNodes = layoutedConnectedNodes.filter((n) => n.type === "k8sService");

  if (ingressNodes.length > 0 && serviceNodes.length >= 2) {
    const ingNode = ingressNodes[0];
    const ingHeight = dagreGraph.node(ingNode.id)?.height || 160;
    const ingressMidY = ingNode.position.y + ingHeight / 2;

    const svcHeight = 85;
    const gap = 50;
    const totalSvcHeight = serviceNodes.length * svcHeight + (serviceNodes.length - 1) * gap;
    let startY = ingressMidY - totalSvcHeight / 2;

    serviceNodes.forEach((svc) => {
      svc.position.y = Math.round(startY);
      startY += svcHeight + gap;
    });
  }

  // Calculate dagreMaxY and dockStartX strictly from freshly computed layoutedConnectedNodes
  let dagreMaxY = 300;
  let dockStartX = 50;

  if (layoutedConnectedNodes.length > 0) {
    const xs = layoutedConnectedNodes.map((n) => n.position.x);
    const bottomYs = layoutedConnectedNodes.map((n) => {
      const h = dagreGraph.node(n.id)?.height || 120;
      return n.position.y + h;
    });
    dockStartX = Math.min(...xs);
    dagreMaxY = Math.max(...bottomYs);
  }

  // Stateless 60px offset underneath dagreMaxY
  const dockStartY = dagreMaxY + 60;
  const layoutedOrphanNodes: Node[] = orphanNodes.map((node, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const posX = dockStartX + col * 304; // 280px width + 24px gap
    const posY = dockStartY + row * 145; // 125px height + 20px gap

    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: { x: posX, y: posY },
    };
  });

  const finalNodes = [...layoutedConnectedNodes, ...layoutedOrphanNodes];

  const layoutedEdges: Edge[] = edges.map((edge) => {
    return {
      ...edge,
      sourceHandle: isHorizontal ? "right-source" : "bottom-source",
      targetHandle: isHorizontal ? "left-target" : "top-target",
    };
  });

  return { nodes: finalNodes, edges: layoutedEdges };
}
