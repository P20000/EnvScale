import { useState } from "react";
import {
  type EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  Position,
  useViewport,
} from "@xyflow/react";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useUIStore } from "../../store/useUIStore";

export interface K8sEdgeData extends Record<string, unknown> {
  healthStatus?: "healthy" | "broken" | "degraded" | "idle" | "draining";
  strokeColor?: string;
  label?: string;
  isDraining?: boolean;
  isCrossWorkload?: boolean;
  isPeerDependency?: boolean;
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
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";
  const { zoom } = useViewport();

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

  const isPeerDependency = Boolean(
    !id.startsWith("e-storage-") &&
    !id.startsWith("e-sys-") &&
    (
      id.startsWith("e-dep-") ||
      edgeData.isCrossWorkload ||
      edgeData.isPeerDependency ||
      (isTB && sourcePosition === Position.Bottom && targetPosition === Position.Top && Math.abs(sourceY - (targetY + 76)) < 20 && Math.abs(sourceX - targetX) > 80)
    )
  );

  let edgePath: string;
  let labelX: number;
  let labelY: number;

  if (isPeerDependency) {
    // Scale arc drop proportionally when zooming out to prevent flattening at smaller scales
    const zoomScale = zoom > 0 ? Math.max(1, Math.min(1.8, 1 / Math.sqrt(zoom))) : 1;

    if (isTB) {
      // TB Layout: Peer cards sit horizontally along X at same tier Y.
      // Route the curve downwards in a compact loop below the workload cards.
      const effTargetY = targetPosition === Position.Top ? targetY + 76 : targetY;
      const effSourceY = sourcePosition === Position.Top ? sourceY + 76 : sourceY;
      const bottomBaseY = Math.max(effSourceY, effTargetY);
      const dx = Math.abs(targetX - sourceX);
      const staggerOffset = Math.abs((sourceX * 13) % 20) * 0.4;
      const baseArcDrop = Math.max(45, Math.min(65, 35 + dx * 0.05)) + staggerOffset;
      const arcDrop = baseArcDrop * zoomScale;
      const arcBottomY = bottomBaseY + arcDrop;

      edgePath = `M ${sourceX} ${effSourceY} C ${sourceX} ${arcBottomY}, ${targetX} ${arcBottomY}, ${targetX} ${effTargetY}`;
      labelX = (sourceX + targetX) / 2;
      labelY = arcBottomY;
    } else {
      // LR Layout: Peer cards sit vertically along Y at same tier X.
      // Route the curve outward to the right in X within the dedicated channel between Col 3 and Col 4.
      const effTargetX = targetPosition === Position.Left ? targetX + 270 : targetX;
      const effSourceX = sourcePosition === Position.Left ? sourceX + 270 : sourceX;
      const rightBaseX = Math.max(effSourceX, effTargetX);
      const dy = Math.abs(targetY - sourceY);
      const staggerOffset = Math.abs((sourceY * 17) % 25) * 0.4;
      const baseArcDrop = Math.max(45, Math.min(65, 35 + dy * 0.05)) + staggerOffset;
      const arcDrop = baseArcDrop * zoomScale;
      const arcRightX = rightBaseX + arcDrop;

      edgePath = `M ${effSourceX} ${sourceY} C ${arcRightX} ${sourceY}, ${arcRightX} ${targetY}, ${effTargetX} ${targetY}`;
      labelX = arcRightX;
      labelY = (sourceY + targetY) / 2;
    }
  } else {
    const [bezierPath, bX, bY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: 0.45,
    });
    edgePath = bezierPath;
    labelX = bX;
    labelY = bY;
  }

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
              zIndex: 20,
            }}
            className={`nodrag nopan text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border ${
              isDraining ? "border-zinc-800 text-zinc-500 opacity-60" : "border-zinc-700 text-zinc-300"
            } shadow-md select-none`}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

K8sEdge.displayName = "K8sEdge";
