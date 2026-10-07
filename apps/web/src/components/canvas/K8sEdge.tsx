import { useState } from "react";
import {
  type EdgeProps,
  getBezierPath,
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

  const selectedNode = useTopologyStore((s) => s.selectedNode);
  const selectedTargetName = selectedNode?.data
    ? String((selectedNode.data as { name?: string; id?: string }).name || (selectedNode.data as { name?: string; id?: string }).id || "")
    : "";

  const isConnectedToSelected = Boolean(
    selectedTargetName && (
      source === selectedTargetName ||
      target === selectedTargetName ||
      source === `group-${selectedTargetName}` ||
      target === `group-${selectedTargetName}` ||
      source.includes(selectedTargetName) ||
      target.includes(selectedTargetName)
    )
  );

  const hasSelection = Boolean(selectedTargetName);
  const isBlastRadiusHighlighted = isConnectedToSelected || isHovered;

  const defaultStroke = isDraining
    ? "#52525b"
    : edgeData.strokeColor || (style.stroke as string) || "#52525b";

  const strokeColor = isBlastRadiusHighlighted
    ? (isDraining ? "#71717a" : edgeData.strokeColor || "#38bdf8")
    : defaultStroke;
  const labelText = (label as string) || edgeData.label || "";

  const edgeOpacity = hasSelection
    ? (isBlastRadiusHighlighted ? 1 : 0.15)
    : (isDraining ? 0.45 : 0.85);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.25,
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
          strokeWidth: isBlastRadiusHighlighted ? (isDraining ? 2 : 2.5) : 1.5,
          opacity: edgeOpacity,
          transition: "stroke 0.2s ease, stroke-width 0.2s ease, opacity 0.25s ease",
          strokeDasharray: isDraining ? "4 4" : style.strokeDasharray || "none",
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
