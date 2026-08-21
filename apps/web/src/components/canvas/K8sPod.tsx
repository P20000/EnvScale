import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, RotateCcw, Trash2 } from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sPodData extends Record<string, unknown> {
  name: string;
  namespace: string;
  nodeName?: string;
  status: "Running" | "CrashLoopBackOff" | "Pending" | "Terminated" | "Failed" | "Unknown";
  restarts: number;
  ip?: string;
  cpuUsage?: string;
  memoryUsage?: string;
}

function formatPodName(name: string, maxLen = 20): string {
  if (!name || name.length <= maxLen) return name;
  const parts = name.split("-");
  if (parts.length >= 2) {
    const suffix = parts.slice(-2).join("-");
    if (suffix.length < maxLen - 5) {
      const prefix = name.slice(0, maxLen - suffix.length - 4);
      return `${prefix}...-${suffix}`;
    }
  }
  const start = name.slice(0, 8);
  const end = name.slice(-6);
  return `${start}...${end}`;
}

export const K8sPodNode = memo(({ id, data, selected }: NodeProps & { data: K8sPodData }) => {
  const deleteNode = useTopologyStore((s) => s.deleteNode);

  const getStatusStyle = () => {
    switch (data.status) {
      case "Running":
        return { dot: "bg-emerald-500", text: "text-emerald-400", border: "border-neutral-800" };
      case "CrashLoopBackOff":
      case "Failed":
        return { dot: "bg-red-500 animate-pulse", text: "text-red-400", border: "border-red-500/40" };
      case "Pending":
        return { dot: "bg-amber-500", text: "text-amber-400", border: "border-amber-500/40" };
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
      className={`relative w-[280px] min-h-[105px] rounded-xl bg-neutral-900 p-3.5 border text-left shadow-lg transition-all ${
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

      {/* Header: Pod Name & Namespace Badge & Delete */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Box className="h-4.5 w-4.5 shrink-0 text-neutral-400" />
          <span className="text-base font-semibold text-neutral-100 truncate" title={data.name}>
            {formatPodName(data.name)}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-300 border border-neutral-700/50">
            {data.namespace}
          </span>
          <button
            onClick={handleDelete}
            title="Delete Pod"
            className="p-1 rounded text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body: Status Dot & Restarts Count */}
      <div className="flex items-center justify-between pt-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusStyle.dot}`} />
          <span className={`text-xs font-semibold ${statusStyle.text}`}>{data.status}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-neutral-300 font-mono bg-neutral-950 px-2.5 py-1 rounded-md border border-neutral-800">
          <RotateCcw className="h-3.5 w-3.5 text-neutral-400" />
          <span>Restarts: {data.restarts}</span>
        </div>
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

K8sPodNode.displayName = "K8sPodNode";
