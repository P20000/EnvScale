import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  MdMemory as Cpu,
  MdSdStorage as HardDrive,
  MdDns as Server,
  MdDelete as Trash2,
} from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sNodeData extends Record<string, unknown> {
  name: string;
  ip: string;
  osImage?: string;
  cpuCapacity?: string;
  memoryCapacity?: string;
  cpuPct: number;
  memoryPct: number;
  status: "Ready" | "NotReady" | "Running" | "Warning" | "Error" | "Inactive";
}

export const K8sWorkerNode = memo(({ id, data, selected }: NodeProps & { data: K8sNodeData }) => {
  const deleteNode = useTopologyStore((s) => s.deleteNode);

  const isCpuHigh = data.cpuPct >= 85;
  const isMemHigh = data.memoryPct >= 85;
  const isWarning = isCpuHigh || isMemHigh || data.status === "Warning";
  const isError = data.status === "Error" || data.status === "NotReady";

  const getStatusDot = () => {
    if (isError) return "bg-red-500";
    if (isWarning) return "bg-amber-500";
    if (data.status === "Inactive") return "bg-neutral-500";
    return "bg-emerald-500";
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  return (
    <div
      className={`group relative w-[360px] rounded-2xl bg-[#141417] p-5 border text-left shadow-xl transition-all ${
        selected
          ? "border-blue-500 ring-1 ring-blue-500 shadow-blue-500/10"
          : isError
          ? "border-red-500/60 bg-red-950/10"
          : isWarning
          ? "border-amber-500/60 bg-amber-950/10"
          : "border-neutral-800"
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

      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`h-3 w-3 rounded-full shrink-0 ${getStatusDot()}`} />
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-800 text-neutral-300 shrink-0 border border-neutral-700/50">
            <Server className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-base font-semibold text-neutral-100 truncate" title={data.name}>
              {data.name}
            </h4>
            <p className="text-xs text-neutral-400 font-medium">Worker Node</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              isError
                ? "bg-red-500/10 text-red-400 border border-red-500/20"
                : isWarning
                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
            }`}
          >
            {data.status || "Ready"}
          </span>

          <button
            onClick={handleDelete}
            title="Delete Node"
            className="p-1 rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Info Rows */}
      <div className="mt-3.5 space-y-3.5 text-xs">
        <div className="flex justify-between font-mono text-xs">
          <span className="text-neutral-400">IP</span>
          <span className="text-neutral-200 font-medium">{data.ip}</span>
        </div>

        {/* CPU Usage Bar */}
        <div>
          <div className="flex justify-between font-mono text-xs mb-1.5">
            <span className="flex items-center gap-1.5 text-neutral-400">
              <Cpu className="h-4 w-4 text-blue-400" /> CPU
            </span>
            <span className="text-neutral-300">
              {data.cpuCapacity || "4 cores"}{" "}
              <span className={isCpuHigh ? "text-amber-400 font-bold" : "text-neutral-400"}>
                {data.cpuPct}%
              </span>
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-neutral-900 overflow-hidden border border-neutral-800/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isCpuHigh ? "bg-amber-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.min(data.cpuPct, 100)}%` }}
            />
          </div>
        </div>

        {/* Memory Usage Bar */}
        <div>
          <div className="flex justify-between font-mono text-xs mb-1.5">
            <span className="flex items-center gap-1.5 text-neutral-400">
              <HardDrive className="h-4 w-4 text-emerald-400" /> Memory
            </span>
            <span className="text-neutral-300">
              {data.memoryCapacity || "8 GiB"}{" "}
              <span className={isMemHigh ? "text-amber-400 font-bold" : "text-neutral-400"}>
                {data.memoryPct}%
              </span>
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-neutral-900 overflow-hidden border border-neutral-800/60">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isMemHigh ? "bg-amber-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(data.memoryPct, 100)}%` }}
            />
          </div>
        </div>
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

K8sWorkerNode.displayName = "K8sWorkerNode";
