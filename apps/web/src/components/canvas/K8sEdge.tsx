import { useState } from "react";
import {
  type EdgeProps,
  getSmoothStepPath,
  EdgeLabelRenderer,
  Position,
} from "@xyflow/react";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sEdgeData extends Record<string, unknown> {
  healthStatus?: "healthy" | "broken" | "degraded" | "idle" | "draining";
  strokeColor?: string;
  label?: string;
  isDraining?: boolean;
}

export function K8sEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Bottom,
  targetPosition = Position.Top,
  style = {},
  data,
  label,
  markerEnd,
}: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);

  const isEndpointTerminating = useTopologyStore((s) => {
    const node = s.nodes.find((n) => (target && n.id === target) || (source && n.id === source));
    if (!node) return false;
    const d = node.data as Record<string, unknown> | undefined;
    return Boolean(d?.isTerminating || d?.phase === "Terminating" || d?.status === "Terminating");
  });

  const edgeData = (data as K8sEdgeData) || {};
  const isDraining = Boolean(
    edgeData.isDraining ||
    edgeData.healthStatus === "draining" ||
    isEndpointTerminating ||
    style.strokeDasharray === "4 4"
  );

  const defaultStroke = isDraining
    ? "#52525b"
    : edgeData.strokeColor || (style.stroke as string) || "#52525b";

  const strokeColor = isHovered
    ? (isDraining ? "#71717a" : "#a1a1aa")
    : defaultStroke;
  const labelText = (label as string) || edgeData.label || "";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path cursor-pointer"
        d={edgePath}
        markerEnd={markerEnd}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: isHovered ? (isDraining ? 2 : 2.5) : 1.5,
          opacity: isDraining ? 0.45 : 1,
          transition: "stroke 0.15s ease, stroke-width 0.15s ease, opacity 0.3s ease",
          strokeDasharray: isDraining ? "4 4" : "none",
        }}
      />

      {labelText && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className={`nodrag nopan text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border ${
              isDraining ? "border-zinc-800 text-zinc-500 opacity-60" : "border-zinc-700 text-zinc-300"
            } shadow-sm select-none`}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

K8sEdge.displayName = "K8sEdge";
