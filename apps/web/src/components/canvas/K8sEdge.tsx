import { useState } from "react";
import {
  type EdgeProps,
  getSmoothStepPath,
  EdgeLabelRenderer,
  Position,
} from "@xyflow/react";

export interface K8sEdgeData extends Record<string, unknown> {
  healthStatus?: "healthy" | "broken" | "degraded" | "idle";
  strokeColor?: string;
  label?: string;
}

export function K8sEdge({
  id,
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

  const edgeData = (data as K8sEdgeData) || {};
  const strokeColor = edgeData.strokeColor || (style.stroke as string) || "#10b981";
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
          strokeWidth: isHovered ? 3.5 : 2,
          filter: isHovered ? `drop-shadow(0 0 6px ${strokeColor})` : "none",
          transition: "stroke-width 0.15s ease, filter 0.15s ease",
          strokeDasharray: "none",
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
            className="nodrag nopan text-[9.5px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[#141417] border border-purple-500/50 text-purple-300 shadow-md select-none"
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

K8sEdge.displayName = "K8sEdge";
