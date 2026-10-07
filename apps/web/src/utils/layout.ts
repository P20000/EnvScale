import dagre from '@dagrejs/dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 100,
    ranksep: 85,
    marginx: 40,
    marginy: 40,
  });

  // Helper to determine node dimensions
  const getNodeDimensions = (node: Node) => {
    if (node.type === "k8sGroup") {
      return { width: 270, height: 76 };
    }
    if (node.type === "k8sPVC") {
      return { width: 200, height: 70 };
    }
    if (node.type === "k8sIngress") {
      return { width: 240, height: 52 };
    }
    if (node.type === "k8sService") {
      return { width: 220, height: 46 };
    }
    if (node.type === "k8sDaemonSet" || node.type === "k8sCronJob" || node.type === "k8sJob") {
      return { width: 260, height: 58 };
    }
    if (node.type === "k8sCompletedJobs") {
      return { width: 260, height: 48 };
    }
    if (node.type === "k8sWorker") {
      return { width: 240, height: 44 };
    }
    return { width: 240, height: 44 };
  };

  // Classify nodes: Architecture DAG nodes vs Side-Rail Dock nodes
  // Architecture DAG nodes: Ingress, Service, Workloads (Deployments/StatefulSets), and PVC Storage
  // Side-Rail Dock nodes: Host workers, DaemonSets, CronJobs, standalone batch jobs, completed jobs
  const isDockNodeType = (node: Node): boolean => {
    if (node.type === "k8sWorker" ||
        node.type === "k8sDaemonSet" ||
        node.type === "k8sCronJob" ||
        node.type === "k8sJob" ||
        node.type === "k8sCompletedJobs") {
      return true;
    }
    // Default cluster internal service with zero connections goes to dock
    if (node.type === "k8sService" && (node.id === "kubernetes" || (node.data as { name?: string })?.name === "kubernetes")) {
      const hasConnection = edges.some((e) => e.source === node.id || e.target === node.id);
      if (!hasConnection) return true;
    }
    return false;
  };

  const dockNodes = nodes.filter(isDockNodeType);
  const dagNodes = nodes.filter((n) => !isDockNodeType(n) && !n.parentId);

  // Add DAG nodes to dagre graph
  dagNodes.forEach((node) => {
    const dims = getNodeDimensions(node);
    if (node.type === "k8sGroup") {
      node.style = { ...node.style, width: dims.width, height: dims.height };
    }
    dagreGraph.setNode(node.id, { width: dims.width, height: dims.height });
  });

  const dagNodeIdSet = new Set(dagNodes.map((n) => n.id));
  // Filter out cross-dependency lateral edges from Dagre rank constraints
  const realDagEdges = edges.filter(
    (e) => !e.id.startsWith("e-dep-") && dagNodeIdSet.has(e.source) && dagNodeIdSet.has(e.target)
  );

  const serviceIds = new Set(dagNodes.filter((n) => n.type === "k8sService").map((n) => n.id));
  const routedWorkloadIds = new Set(
    realDagEdges.filter((e) => serviceIds.has(e.source)).map((e) => e.target)
  );

  const tier0 = dagNodes.filter((n) => n.type === "k8sIngress");
  const tier1 = dagNodes.filter((n) => n.type === "k8sService");
  const tier2 = dagNodes.filter((n) => n.type === "k8sGroup");
  const tier3 = dagNodes.filter((n) => n.type === "k8sPVC");

  const unroutedWorkloads = tier2.filter((grp) => !routedWorkloadIds.has(grp.id));
  const routedDagNodes = routedWorkloadIds.size > 0
    ? dagNodes.filter((n) => n.type === "k8sIngress" || n.type === "k8sService" || routedWorkloadIds.has(n.id))
    : dagNodes;

  // Add routed DAG nodes to dagre graph
  routedDagNodes.forEach((node) => {
    const dims = getNodeDimensions(node);
    if (node.type === "k8sGroup") {
      node.style = { ...node.style, width: dims.width, height: dims.height };
    }
    dagreGraph.setNode(node.id, { width: dims.width, height: dims.height });
  });

  const routedNodeIdSet = new Set(routedDagNodes.map((n) => n.id));
  const routedDagEdges = realDagEdges.filter(
    (e) => routedNodeIdSet.has(e.source) && routedNodeIdSet.has(e.target)
  );

  routedDagEdges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target, { weight: 2 });
  });

  const inDegrees = new Map<string, number>();
  routedDagNodes.forEach((n) => inDegrees.set(n.id, 0));
  routedDagEdges.forEach((e) => {
    inDegrees.set(e.target, (inDegrees.get(e.target) || 0) + 1);
  });

  const anchor0 = tier0[0];

  // Align unrouted Services (e.g. redis-headless-service) to Tier 1
  if (anchor0) {
    tier1.forEach((svc) => {
      if ((inDegrees.get(svc.id) || 0) === 0) {
        dagreGraph.setEdge(anchor0.id, svc.id, { minlen: 1, weight: 0 });
      }
    });
  } else {
    dagreGraph.setNode("__virtual_root__", { width: 1, height: 1 });
    tier1.forEach((svc) => {
      if ((inDegrees.get(svc.id) || 0) === 0) {
        dagreGraph.setEdge("__virtual_root__", svc.id, { minlen: 1, weight: 0 });
      }
    });
  }

  if (routedDagNodes.length > 0) {
    dagre.layout(dagreGraph);
  }

  // Calculate bounding box and Tier Y levels from routed layout
  let maxRoutedX = 300;
  let minRoutedY = 40;
  let tier2Y = 350;

  if (routedDagNodes.length > 0) {
    let maxX = -Infinity;
    let minY = Infinity;
    routedDagNodes.forEach((n) => {
      const gNode = dagreGraph.node(n.id);
      if (gNode) {
        const dims = getNodeDimensions(n);
        const w = gNode.width ?? dims.width;
        const h = gNode.height ?? dims.height;
        const rightX = gNode.x + w / 2;
        const topY = gNode.y - h / 2;
        if (rightX > maxX) maxX = rightX;
        if (topY < minY) minY = topY;
        if (n.type === "k8sGroup") tier2Y = gNode.y;
      }
    });
    if (maxX !== -Infinity) maxRoutedX = maxX;
    if (minY !== Infinity) minRoutedY = minY;
  }

  const tier3Y = tier2Y + 160;

  // Custom positioning map for unrouted compute & attached storage
  const customPosMap = new Map<string, { x: number; y: number }>();

  // Place unrouted standalone compute workloads together to the right of the routed tree
  let currentUnroutedX = maxRoutedX + 100;
  let totalDagMaxX = maxRoutedX;

  unroutedWorkloads.forEach((u) => {
    const dims = getNodeDimensions(u);
    if (u.type === "k8sGroup") {
      u.style = { ...u.style, width: dims.width, height: dims.height };
    }
    const posX = currentUnroutedX + dims.width / 2;
    customPosMap.set(u.id, { x: posX - dims.width / 2, y: tier2Y - dims.height / 2 });

    // If unrouted workload has an attached PVC, drop it directly below
    const attachedPVCEdge = realDagEdges.find((e) => e.source === u.id);
    if (attachedPVCEdge) {
      const pvcNode = tier3.find((p) => p.id === attachedPVCEdge.target);
      if (pvcNode) {
        const pDims = getNodeDimensions(pvcNode);
        customPosMap.set(pvcNode.id, { x: posX - pDims.width / 2, y: tier3Y - pDims.height / 2 });
      }
    }

    currentUnroutedX += dims.width + 100;
    if (currentUnroutedX > totalDagMaxX) totalDagMaxX = currentUnroutedX;
  });

  const MIN_SIDE_RAIL_X = 1100;
  const dockStartX = Math.max(totalDagMaxX + 100, MIN_SIDE_RAIL_X);
  const dockStartY = Math.max(minRoutedY, 40);

  const isTB = direction === "TB";
  const targetPos = isTB ? Position.Top : Position.Left;
  const sourcePos = isTB ? Position.Bottom : Position.Right;

  const getDockTier = (node: Node): number => {
    if (node.type === "k8sWorker") return 1;        // Host Node (e.g. minikube)
    if (node.type === "k8sDaemonSet") return 2;     // DaemonSets (e.g. node-telemetry-agent)
    if (node.type === "k8sCronJob") return 3;       // CronJobs (e.g. db-audit-cronjob)
    if (node.type === "k8sJob") return 4;           // Standalone batch jobs
    if (node.type === "k8sCompletedJobs") return 5; // Collapsed Completed Jobs
    return 6;                                       // Standalone utilities (e.g. default kubernetes svc)
  };

  const sortedDockNodes = [...dockNodes].sort((a, b) => {
    const tierA = getDockTier(a);
    const tierB = getDockTier(b);
    if (tierA !== tierB) return tierA - tierB;
    return a.id.localeCompare(b.id);
  });

  const dockPosMap = new Map<string, { x: number; y: number }>();
  let currentDockY = dockStartY;

  sortedDockNodes.forEach((node) => {
    const dims = getNodeDimensions(node);
    if (node.type === "k8sGroup") {
      node.style = { ...node.style, width: dims.width, height: dims.height };
    }
    dockPosMap.set(node.id, { x: dockStartX, y: currentDockY });
    currentDockY += dims.height + 20;
  });

  const layoutedNodes = nodes.map((node) => {
    if (node.parentId) {
      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
      };
    }

    if (dockPosMap.has(node.id)) {
      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
        position: dockPosMap.get(node.id)!,
      };
    }

    if (customPosMap.has(node.id)) {
      return {
        ...node,
        targetPosition: targetPos,
        sourcePosition: sourcePos,
        position: customPosMap.get(node.id)!,
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
