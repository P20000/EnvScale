import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Globe, ArrowRightLeft, Trash2 } from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sServiceData extends Record<string, unknown> {
  name: string;
  type: "ClusterIP" | "LoadBalancer" | "NodePort" | "Ingress";
  port: string;
  targetPort?: string;
}

export const K8sServiceNode = memo(({ id, data, selected }: NodeProps & { data: K8sServiceData }) => {
  const deleteNode = useTopologyStore((s) => s.deleteNode);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  return (
    <div
      className={`relative flex items-center gap-3.5 min-w-[250px] rounded-xl bg-[#141417] px-4.5 py-3 border text-left shadow-lg transition-all ${
        selected
          ? "border-blue-500 ring-1 ring-blue-500 shadow-blue-500/10"
          : "border-neutral-800"
      }`}
    >
      {/* 4-Sided Handles: TOP */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />

      {/* 4-Sided Handles: LEFT */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-source"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />

      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
        {data.type === "Ingress" || data.type === "LoadBalancer" ? (
          <Globe className="h-5 w-5" />
        ) : (
          <ArrowRightLeft className="h-5 w-5" />
        )}
      </div>

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 justify-between">
          <span className="text-base font-semibold text-neutral-100 truncate" title={data.name}>
            {data.name}
          </span>
          <span className="text-xs font-mono text-blue-400 font-bold ml-1">{data.port}</span>
        </div>
        <span className="text-xs text-neutral-400 font-mono">{data.type}</span>
      </div>

      <button
        onClick={handleDelete}
        title="Delete Service"
        className="p-1 rounded-full text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors ml-1"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {/* 4-Sided Handles: RIGHT */}
      <Handle
        type="target"
        position={Position.Right}
        id="right-target"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />

      {/* 4-Sided Handles: BOTTOM */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!w-3 !h-3 !bg-neutral-800 !border-neutral-600 hover:!bg-blue-500 transition-colors"
      />
    </div>
  );
});

K8sServiceNode.displayName = "K8sServiceNode";
