import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Network, Trash2 } from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface IngressRuleData {
  host: string;
  path: string;
  serviceName: string;
  servicePort: number;
}

export interface K8sIngressData extends Record<string, unknown> {
  name: string;
  namespace: string;
  rules: IngressRuleData[];
}

export const K8sIngressNode = memo(({ id, data, selected }: NodeProps & { data: K8sIngressData }) => {
  const deleteNode = useTopologyStore((s) => s.deleteNode);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  return (
    <div
      className={`relative flex flex-col min-w-[280px] rounded-xl bg-[#141417] px-4.5 py-3 border text-left shadow-lg transition-all ${
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

      <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800/80">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20 shrink-0">
            <Network className="h-5 w-5" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-base font-semibold text-neutral-100 truncate" title={data.name}>
              {data.name}
            </span>
            <span className="text-[10px] font-mono text-neutral-400 font-bold uppercase tracking-wider">
              INGRESS
            </span>
          </div>
        </div>
        <button
          onClick={handleDelete}
          title="Delete Ingress"
          className="p-1 rounded-full text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {data.rules && data.rules.length > 0 ? (
          data.rules.map((rule, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-300 truncate max-w-[120px]" title={rule.host || "*"}>
                {rule.host || "*"}
              </span>
              <span className="text-neutral-500">➔</span>
              <span className="text-blue-400 truncate max-w-[120px]" title={rule.serviceName}>
                {rule.serviceName}:{rule.servicePort}
              </span>
            </div>
          ))
        ) : (
          <span className="text-xs text-neutral-500 italic">No rules defined</span>
        )}
      </div>

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

K8sIngressNode.displayName = "K8sIngressNode";
