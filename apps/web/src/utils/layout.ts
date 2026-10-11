import dagre from '@dagrejs/dagre';
import { type Node, type Edge, Position } from '@xyflow/react';

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const isLR = direction === "LR";
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: isLR ? 70 : 55,
    ranksep: isLR ? 115 : 110,
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

  const unroutedWorkloads = tier2
    .filter((grp) => !routedWorkloadIds.has(grp.id))
    .sort((a, b) => {
      // Prioritize pure compute workloads (e.g. WORKER-POOL) before storage-attached workloads.
      // Moving storage-attached workloads (e.g. TODO-MEDIA-STORAGE) and its PVC to the far right end
      // keeps all Tier 3 storage nodes clustered at the outer edge rather than between compute workloads.
      const aHasStorage = realDagEdges.some((e) => e.source === a.id);
      const bHasStorage = realDagEdges.some((e) => e.source === b.id);
      if (aHasStorage !== bHasStorage) return aHasStorage ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
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

  // Calculate bounding box and Tier levels from routed layout
  let minRoutedX = 40;
  let maxRoutedX = 300;
  let minRoutedY = 40;
  let maxRoutedY = 350;

  if (routedDagNodes.length > 0) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    routedDagNodes.forEach((n) => {
      const gNode = dagreGraph.node(n.id);
      if (gNode) {
        const dims = getNodeDimensions(n);
        const w = gNode.width ?? dims.width;
        const h = gNode.height ?? dims.height;
        const leftX = gNode.x - w / 2;
        const rightX = gNode.x + w / 2;
        const topY = gNode.y - h / 2;
        const bottomY = gNode.y + h / 2;
        if (leftX < minX) minX = leftX;
        if (rightX > maxX) maxX = rightX;
        if (topY < minY) minY = topY;
        if (bottomY > maxY) maxY = bottomY;
      }
    });
    if (minX !== Infinity) minRoutedX = minX;
    if (maxX !== -Infinity) maxRoutedX = maxX;
    if (minY !== Infinity) minRoutedY = minY;
    if (maxY !== -Infinity) maxRoutedY = maxY;
  }

  // Custom positioning map for unrouted compute & attached storage
  const customPosMap = new Map<string, { x: number; y: number }>();
  let totalDagMaxX: number;

  if (isLR) {
    // Horizontal (LR) mode: Stack unrouted workloads vertically into a dedicated Column 4
    // 170px clearance gives Column 3 lateral peer dependency curves (e.g. backend -> redis) a dedicated, collision-free channel
    const unroutedColX = maxRoutedX + 170;
    let currentUnroutedY = Math.max(minRoutedY, 40);

    unroutedWorkloads.forEach((u) => {
      const dims = getNodeDimensions(u);
      if (u.type === "k8sGroup") {
        u.style = { ...u.style, width: dims.width, height: dims.height };
      }
      customPosMap.set(u.id, { x: unroutedColX, y: currentUnroutedY });

      // If unrouted workload has an attached PVC, drop it directly below
      const attachedPVCEdge = realDagEdges.find((e) => e.source === u.id);
      if (attachedPVCEdge) {
        const pvcNode = tier3.find((p) => p.id === attachedPVCEdge.target);
        if (pvcNode) {
          const pDims = getNodeDimensions(pvcNode);
          const pvcY = currentUnroutedY + dims.height + 35;
          const pvcX = unroutedColX + (dims.width - pDims.width) / 2;
          customPosMap.set(pvcNode.id, { x: pvcX, y: pvcY });
          currentUnroutedY = pvcY + pDims.height + 25;
          return;
        }
      }

      currentUnroutedY += dims.height + 25;
    });

    totalDagMaxX = unroutedWorkloads.length > 0 ? unroutedColX + 270 : maxRoutedX;
  } else {
    // Vertical (TB) mode: Place unrouted standalone workloads in a dedicated lower tier (Tier 3) directly below Tier 2
    // This prevents stretching the canvas into a 2,800px-wide ribbon and creates a compact, screen-fitting vertical hierarchy
    const tier3Y = maxRoutedY + 90;
    let currentUnroutedX = minRoutedX;

    unroutedWorkloads.forEach((u) => {
      const dims = getNodeDimensions(u);
      if (u.type === "k8sGroup") {
        u.style = { ...u.style, width: dims.width, height: dims.height };
      }
      customPosMap.set(u.id, { x: currentUnroutedX, y: tier3Y });

      // If unrouted workload has an attached PVC, drop it directly below at Tier 4
      const attachedPVCEdge = realDagEdges.find((e) => e.source === u.id);
      if (attachedPVCEdge) {
        const pvcNode = tier3.find((p) => p.id === attachedPVCEdge.target);
        if (pvcNode) {
          const pDims = getNodeDimensions(pvcNode);
          const pvcY = tier3Y + dims.height + 35;
          const pvcX = currentUnroutedX + (dims.width - pDims.width) / 2;
          customPosMap.set(pvcNode.id, { x: pvcX, y: pvcY });
        }
      }

      currentUnroutedX += dims.width + 45;
    });

    totalDagMaxX = Math.max(maxRoutedX, currentUnroutedX - 45);
  }

  const MIN_SIDE_RAIL_X = 1100;
  const dockStartX = Math.max(totalDagMaxX + 80, MIN_SIDE_RAIL_X);
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

  const nodePosMap = new Map<string, { x: number; y: number; width: number; height: number }>();
  layoutedNodes.forEach((n) => {
    const dims = getNodeDimensions(n);
    nodePosMap.set(n.id, {
      x: n.position.x,
      y: n.position.y,
      width: dims.width,
      height: dims.height,
    });
  });

  const layoutedEdges = edges.map((edge) => {
    const src = nodePosMap.get(edge.source);
    const tgt = nodePosMap.get(edge.target);
    if (!src || !tgt) return edge;

    const scx = src.x + src.width / 2;
    const scy = src.y + src.height / 2;
    const tcx = tgt.x + tgt.width / 2;
    const tcy = tgt.y + tgt.height / 2;

    const dx = tcx - scx;
    const dy = tcy - scy;

    // 1. Attached Storage Volumes (Workload -> PVC)
    if (edge.id.startsWith("e-storage-")) {
      // If the PVC is stacked vertically below the workload
      if (dy > 40 && Math.abs(dx) < 120) {
        return {
          ...edge,
          sourceHandle: "source-bottom",
          targetHandle: "target-top",
        };
      }
      return {
        ...edge,
        sourceHandle: "source-right",
        targetHandle: "target-left",
      };
    }

    // 2. Cross-workload peer dependencies (e.g. backend -> redis database)
    if (edge.id.startsWith("e-dep-") || edge.data?.isCrossWorkload) {
      return edge;
    }

    // 3. Architecture DAG connections (Ingress -> Service, Service -> Workload)
    if (isLR) {
      // If target is directly below source (vertical drop branch)
      if (dy > 60 && Math.abs(dx) < 80) {
        return {
          ...edge,
          sourceHandle: "source-bottom",
          targetHandle: "target-top",
        };
      }
      // If target is directly above source
      if (dy < -60 && Math.abs(dx) < 80) {
        return {
          ...edge,
          sourceHandle: "source-top",
          targetHandle: "target-bottom",
        };
      }
      // Standard horizontal left-to-right flow
      return {
        ...edge,
        sourceHandle: "source-right",
        targetHandle: "target-left",
      };
    } else {
      // Vertical (TB) flow:
      if (Math.abs(dx) > 80 && Math.abs(dy) < 60) {
        return {
          ...edge,
          sourceHandle: dx > 0 ? "source-right" : "source-left",
          targetHandle: dx > 0 ? "target-left" : "target-right",
        };
      }
      return {
        ...edge,
        sourceHandle: "source-bottom",
        targetHandle: "target-top",
      };
    }
  });

  return { nodes: layoutedNodes, edges: layoutedEdges };
};
