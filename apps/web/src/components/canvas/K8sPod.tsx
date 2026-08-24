import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  MdViewInAr as Box,
  MdRefresh as RotateCcw,
  MdDelete as Trash2,
  MdAutorenew as Loader2,
} from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sPodData extends Record<string, unknown> {
  name: string;
  namespace: string;
  nodeName?: string;
  status: "Running" | "CrashLoopBackOff" | "Pending" | "ContainerCreating" | "Terminating" | "Terminated" | "Failed" | "Unknown";
  restarts: number;
  ip?: string;
  cpuUsage?: string;
  memoryUsage?: string;
  ownerName?: string;
  ownerKind?: string;
  ownerUid?: string;
}

export const K8sPodNode = memo(({ id, data, selected }: NodeProps & { data: K8sPodData }) => {
  const deleteNode = useTopologyStore((s) => s.deleteNode);

  const isCreating = data.status === "ContainerCreating" || data.status === "Pending";
  const isTerminating = data.status === "Terminating" || data.status === "Terminated";

  const getStatusStyle = () => {
    switch (data.status) {
      case "Running":
        return { dot: "bg-emerald-500", text: "text-emerald-400", border: "border-neutral-800" };
      case "ContainerCreating":
      case "Pending":
        return {
          dot: "bg-blue-400 animate-ping",
          text: "text-blue-400 font-semibold animate-pulse",
          border: "border-blue-500/50 bg-blue-950/20 backdrop-blur-md animate-pulse shadow-blue-500/10",
        };
      case "Terminating":
      case "Terminated":
        return {
          dot: "bg-red-400 animate-ping",
          text: "text-red-400 font-semibold opacity-75",
          border: "border-red-500/40 bg-neutral-900/40 opacity-40 scale-95 transition-all duration-500",
        };
      case "CrashLoopBackOff":
      case "Failed":
        return { dot: "bg-red-500 animate-pulse", text: "text-red-400", border: "border-red-500/40" };
      default:
        return { dot: "bg-neutral-500", text: "text-neutral-400", border: "border-neutral-800" };
    }
  };

  const statusStyle = getStatusStyle();

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteNode(id);
  };

  return (
    <div
      className={`group relative w-[280px] min-h-[105px] rounded-xl bg-neutral-900 p-3.5 border text-left shadow-lg transition-all ${
        selected
          ? "border-blue-500 ring-1 ring-blue-500 shadow-blue-500/10"
          : statusStyle.border
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

      {/* Header: Pod Name & Delete */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Box className="h-4.5 w-4.5 shrink-0 text-neutral-400" />
          <div className="min-w-0 flex-1">
            <span className="text-[13px] leading-tight font-semibold text-neutral-100 block truncate" title={data.name}>
              {data.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleDelete}
            title="Delete Pod"
            className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body: Status Dot, Namespace & Restarts Count */}
      <div className="flex items-center justify-between pt-3 gap-2">
        <div className="flex items-center gap-2 shrink-0">
          {isCreating ? (
            <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
          ) : isTerminating ? (
            <Loader2 className="h-3 w-3 text-red-400 animate-spin" />
          ) : (
            <span className={`h-2 w-2 rounded-full ${statusStyle.dot}`} />
          )}
          <span className={`text-[11px] font-semibold ${statusStyle.text}`}>{data.status}</span>
        </div>

        <div className="flex items-center gap-2 min-w-0 justify-end">
          <span className="rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400 border border-neutral-700/50 truncate shrink" title={data.namespace}>
            {data.namespace}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-neutral-300 font-mono bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800 shrink-0" title="Restarts">
            <RotateCcw className="h-3 w-3 text-neutral-500" />
            <span>{data.restarts}</span>
          </div>
        </div>
      </div>

      {/* Metrics & Node Info */}
      <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-neutral-800/80">
        <div className="flex items-center gap-2">
          {data.nodeName && (
            <span className="text-[10px] text-neutral-400 font-mono truncate max-w-[100px]" title={data.nodeName}>
              @{data.nodeName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-mono">
          <span title="CPU Usage">{data.cpuUsage || "0 mcores"}</span>
          <span className="text-neutral-700">|</span>
          <span title="Memory Usage">{data.memoryUsage || "0 MiB"}</span>
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

K8sPodNode.displayName = "K8sPodNode";
