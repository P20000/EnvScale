import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Copy, Layers, Database } from "lucide-react";

export interface K8sWorkloadData extends Record<string, unknown> {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  workloadType: "Deployment" | "ReplicaSet" | "StatefulSet";
}

export const K8sWorkloadNode = memo(({ data }: { data: K8sWorkloadData }) => {
  const isHealthy = data.readyReplicas >= data.replicas;
  const isWarning = data.readyReplicas > 0 && data.readyReplicas < data.replicas;
  const isError = data.readyReplicas === 0 && data.replicas > 0;

  const getStatusDot = () => {
    if (isError) return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]";
    if (isWarning) return "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]";
    return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]";
  };

  const getIcon = () => {
    if (data.workloadType === "StatefulSet") return <Database className="h-4.5 w-4.5" />;
    if (data.workloadType === "Deployment") return <Layers className="h-4.5 w-4.5" />;
    return <Copy className="h-4.5 w-4.5" />; // ReplicaSet
  };

  return (
    <div
      className={`group relative w-[280px] rounded-xl bg-neutral-900/90 p-3.5 backdrop-blur-xl border transition-all duration-300 ${
        isError
          ? "border-red-500/50 shadow-red-500/10"
          : isWarning
          ? "border-amber-500/50 shadow-amber-500/10"
          : "border-emerald-500/30 hover:border-blue-500 hover:ring-1 hover:ring-blue-500 hover:shadow-blue-500/10"
      }`}
    >
      {/* 4-Sided Handles: TOP */}
      <Handle
        type="target"
        position={Position.Top}
        id="top-target"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />

      {/* 4-Sided Handles: LEFT */}
      <Handle
        type="target"
        position={Position.Left}
        id="left-target"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-source"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800/80 pb-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300 shrink-0 border border-neutral-700/50">
            {getIcon()}
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-[13px] leading-tight font-semibold text-neutral-100 block truncate" title={data.name}>
              {data.name}
            </span>
            <span className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider block">
              {data.workloadType}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pl-2">
          <span className={`h-2.5 w-2.5 rounded-full ${getStatusDot()}`} />
        </div>
      </div>

      {/* Body: Replicas & Namespace */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400 border border-neutral-700/50 truncate shrink" title={data.namespace}>
          {data.namespace}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            isHealthy
              ? "bg-emerald-500/10 text-emerald-400"
              : isError
              ? "bg-red-500/10 text-red-400"
              : "bg-amber-500/10 text-amber-400"
          }`}
        >
          {data.readyReplicas} / {data.replicas}
        </span>
      </div>

      {/* 4-Sided Handles: RIGHT */}
      <Handle
        type="target"
        position={Position.Right}
        id="right-target"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />

      {/* 4-Sided Handles: BOTTOM */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom-target"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        className="!w-2.5 !h-2.5 !bg-blue-500 !border-none opacity-0 group-hover:opacity-100 hover:!scale-125 transition-all duration-200"
      />
    </div>
  );
});

K8sWorkloadNode.displayName = "K8sWorkloadNode";
