import { useCallback } from "react";
import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { Trash2 } from "lucide-react";

export type WorkflowNodeData = {
  label: string;
  shape: "rectangle" | "circle" | "diamond" | "cylinder" | "hexagon";
  color?: string;
};

export default function WorkflowNode({ id, data }: NodeProps) {
  const nodeData = data as WorkflowNodeData;
  const { deleteElements } = useReactFlow();

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteElements({ nodes: [{ id }] });
    },
    [deleteElements, id]
  );

  const shape = nodeData.shape || "rectangle";

  return (
    <div className={`workflow-node-wrapper workflow-${shape}`}>
      {/* Target Handles (All 4 Sides) */}
      <Handle
        id="target-top"
        type="target"
        position={Position.Top}
        style={{ left: "35%" }}
        className="workflow-handle workflow-handle-target"
      />
      <Handle
        id="target-right"
        type="target"
        position={Position.Right}
        style={{ top: "35%" }}
        className="workflow-handle workflow-handle-target"
      />
      <Handle
        id="target-bottom"
        type="target"
        position={Position.Bottom}
        style={{ left: "35%" }}
        className="workflow-handle workflow-handle-target"
      />
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        style={{ top: "35%" }}
        className="workflow-handle workflow-handle-target"
      />

      {/* Source Handles (All 4 Sides) */}
      <Handle
        id="source-top"
        type="source"
        position={Position.Top}
        style={{ left: "65%" }}
        className="workflow-handle workflow-handle-source"
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        style={{ top: "65%" }}
        className="workflow-handle workflow-handle-source"
      />
      <Handle
        id="source-bottom"
        type="source"
        position={Position.Bottom}
        style={{ left: "65%" }}
        className="workflow-handle workflow-handle-source"
      />
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        style={{ top: "65%" }}
        className="workflow-handle workflow-handle-source"
      />

      {/* Delete Button */}
      <button
        type="button"
        className="workflow-node-delete nodrag nopan"
        title="Delete node"
        onClick={handleDelete}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {/* Node Content */}
      <div className="workflow-node-content">
        {shape === "diamond" ? (
          <div className="workflow-diamond-inner">
            <span className="workflow-node-label">{nodeData.label}</span>
          </div>
        ) : shape === "hexagon" ? (
          <div className="workflow-hexagon-inner">
            <span className="workflow-node-label">{nodeData.label}</span>
          </div>
        ) : (
          <span className="workflow-node-label">{nodeData.label}</span>
        )}
      </div>
    </div>
  );
}

