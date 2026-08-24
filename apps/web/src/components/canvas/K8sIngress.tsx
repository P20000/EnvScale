import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  MdRouter as Network,
  MdDelete as Trash2,
} from "react-icons/md";
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
      className={`group relative flex flex-col w-[320px] rounded-xl bg-[#141417] p-4 border text-left shadow-xl transition-all ${
        selected
          ? "border-violet-500 ring-1 ring-violet-500 shadow-violet-500/20"
          : "border-neutral-800/80 hover:border-violet-500/50"
      }`}
    >
      {/* 4-Sided Handles: TOP */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />

      {/* 4-Sided Handles: LEFT */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-source"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />

      <div className="flex items-center justify-between pb-3 mb-3 border-b border-neutral-800/80">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 shrink-0">
            <Network className="h-4.5 w-4.5" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[13px] font-semibold text-neutral-100 truncate leading-tight" title={data.name}>
              {data.name}
            </span>
            <span className="text-[10px] font-mono text-violet-400/90 font-medium tracking-wider uppercase mt-0.5">
              Ingress Controller
            </span>
          </div>
        </div>
        <button
          onClick={handleDelete}
          title="Delete Ingress"
          className="p-1 rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono font-medium text-neutral-400 uppercase tracking-wider">
          Routing Rules
        </span>
        {data.rules && data.rules.length > 0 ? (
          <div className="flex flex-col gap-1.5 bg-neutral-900/80 rounded-lg p-2 border border-neutral-800/60">
            {data.rules.map((rule, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs font-mono bg-neutral-950/60 px-2.5 py-1.5 rounded border border-neutral-800/50 gap-1.5">
                <span className="text-neutral-300 truncate shrink-0 max-w-[80px]" title={rule.host ? `${rule.host}${rule.path || ""}` : rule.path || "*"}>
                  {rule.host ? `${rule.host}` : "*"}
                </span>
                <span className="text-neutral-500 text-[10px] shrink-0">➔</span>
                <span className="text-blue-400 font-semibold truncate text-right flex-1 min-w-0" title={`${rule.serviceName}:${rule.servicePort}`}>
                  {rule.serviceName}:{rule.servicePort}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-neutral-900/60 rounded-lg p-2 border border-neutral-800/50 text-center">
            <span className="text-xs text-neutral-500 italic">No routing rules defined</span>
          </div>
        )}
      </div>

      {/* 4-Sided Handles: RIGHT */}
      <Handle
        type="target"
        position={Position.Right}
        id="right-target"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />

      {/* 4-Sided Handles: BOTTOM */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!w-0 !h-0 !border-none !bg-transparent !opacity-0 !pointer-events-none"
      />
    </div>
  );
});

K8sIngressNode.displayName = "K8sIngressNode";
