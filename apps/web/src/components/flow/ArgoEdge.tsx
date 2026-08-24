import React from 'react';
import { type EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';

export function ArgoEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style = {},
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 8,
  });

  return (
    <>
      <path
        id={id}
        style={{ ...style, stroke: '#27272a', strokeWidth: 1.5, fill: 'none' }}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan text-[9px] font-mono text-zinc-500 bg-zinc-950 px-1 py-0.5 rounded border border-zinc-900 select-none z-10"
          >
            {label as React.ReactNode}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
