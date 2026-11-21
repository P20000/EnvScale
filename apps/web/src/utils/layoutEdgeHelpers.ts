import type { Node, Edge } from "@xyflow/react";

export const calculateLayoutedEdges = (
  layoutedNodes: Node[],
  edges: Edge[],
  isLR: boolean,
  getNodeDimensions: (node: Node) => { width: number; height: number }
): Edge[] => {
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

  return edges.map((edge) => {
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
      return {
        ...edge,
        sourceHandle: isLR ? "source-right" : "source-bottom",
        targetHandle: isLR ? "target-right" : "target-bottom",
      };
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
};
