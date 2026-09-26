import { Handle, Position } from "@xyflow/react";
import { MdStorage as Icon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sPVCData extends Record<string, unknown> {
  name: string;
  namespace: string;
  status: "Pending" | "Bound" | "Lost" | "Unknown" | string;
  phase?: string;
  requestedCapacity?: string;
  capacity?: string;
  actualCapacity?: string;
  accessModes?: string[];
  storageClassName?: string;
  storageClass?: string;
  volumeName?: string;
  volumeMode?: string;
  mountedByPods?: string[];
  createdAt?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selector?: Record<string, string>;
}

export function K8sPVCNode({ data }: { data: K8sPVCData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const rawPhase = String(data.phase || data.status || "Bound").trim();
  const phaseLower = rawPhase.toLowerCase();

  let dotClass = "bg-emerald-500";
  let statusText = "Bound";
  let statusClass = "text-zinc-200";

  if (phaseLower === "pending" || phaseLower.includes("wait")) {
    dotClass = "bg-amber-400 animate-pulse";
    statusText = "Pending";
    statusClass = "text-amber-300";
  } else if (phaseLower === "lost" || phaseLower.includes("fail") || phaseLower.includes("error")) {
    dotClass = "bg-rose-500";
    statusText = "Lost";
    statusClass = "text-rose-300";
  }

  const requestedCap = data.requestedCapacity || data.capacity || data.actualCapacity || "Storage";
  const storageClass = data.storageClassName || data.storageClass || "standard";

  return (
    <div className="h-[54px] w-[240px] border border-cyan-900/60 bg-[#12161a] hover:border-cyan-500/50 flex flex-col justify-between p-2 rounded-md select-none group transition-all relative shadow-sm">
      <Handle
        type="target"
        position={isTB ? Position.Top : Position.Left}
        id="left-target"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />
      <Handle
        type="source"
        position={isTB ? Position.Bottom : Position.Right}
        id="right-source"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />

      {/* Top row: PVC Icon + Name + Status Indicator */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-cyan-400 shrink-0" />
          <span className="text-xs font-mono font-semibold text-zinc-100 truncate max-w-[150px]" title={data.name}>
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] font-mono font-medium ${statusClass}`}>
            {statusText}
          </span>
          <div className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
        </div>
      </div>

      {/* Bottom row: Namespace + StorageClass Badge + Capacity Badge */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
        <span className="truncate max-w-[80px]" title={data.namespace || "default"}>
          {data.namespace || "default"}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="px-1 py-0.2 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 text-[9px] truncate max-w-[70px]"
            title={`StorageClass: ${storageClass}`}
          >
            {storageClass}
          </span>
          <span className="px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-semibold text-[10px]">
            {requestedCap}
          </span>
        </div>
      </div>
    </div>
  );
}

K8sPVCNode.displayName = "K8sPVCNode";
