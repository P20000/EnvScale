import { Handle, Position } from "@xyflow/react";
import { MdOutlineSdStorage as Icon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { K8sPVData } from "../../store/types/topologyTypes";

export function K8sPVNode({ data }: { data: K8sPVData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const rawStatus = String(data.status || "Available").trim();
  const statusLower = rawStatus.toLowerCase();

  let dotClass = "bg-emerald-500";
  let statusClass = "text-zinc-200";

  if (statusLower === "bound") {
    dotClass = "bg-cyan-400";
    statusClass = "text-cyan-300";
  } else if (statusLower === "released") {
    dotClass = "bg-amber-400";
    statusClass = "text-amber-300";
  } else if (statusLower === "failed") {
    dotClass = "bg-rose-500";
    statusClass = "text-rose-300";
  } else if (statusLower === "available") {
    dotClass = "bg-emerald-500";
    statusClass = "text-emerald-300";
  }

  const capacity = data.capacity || "—";
  const storageClass = data.storageClassName || "—";
  const volumeSource = data.volumeSource || data.csiDriver || "—";

  return (
    <div className="h-[54px] w-[240px] border border-violet-900/60 bg-[#12161a] hover:border-violet-500/50 flex flex-col justify-between p-2 rounded-md select-none group transition-all relative shadow-sm">
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

      {/* Top row: Icon + Name + Status dot */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-violet-400 shrink-0" />
          <span className="text-xs font-mono font-semibold text-zinc-100 truncate max-w-[140px]" title={data.name}>
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] font-mono font-medium ${statusClass}`}>{rawStatus}</span>
          <div className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
        </div>
      </div>

      {/* Bottom row: StorageClass + Capacity + VolumeSource */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
        <span className="truncate max-w-[80px]" title={storageClass}>{storageClass}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {volumeSource !== "—" && (
            <span
              className="px-1 py-0.2 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 text-[9px] truncate max-w-[60px]"
              title={volumeSource}
            >
              {volumeSource}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 font-semibold text-[10px]">
            {capacity}
          </span>
        </div>
      </div>
    </div>
  );
}

K8sPVNode.displayName = "K8sPVNode";
