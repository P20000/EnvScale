import { Handle, Position } from "@xyflow/react";
import { MdStorage as StorageIcon } from "react-icons/md";
import { useUIStore } from "../../store/useUIStore";
import type { K8sPVCData } from "../../store/types/topologyTypes";

export function K8sPVCNode({ data }: { data: K8sPVCData }) {
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const phase = data.phase || "Bound";
  const isBound = phase === "Bound";
  const isPending = phase === "Pending";

  const phaseClass = isBound
    ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
    : isPending
    ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
    : "text-rose-400 bg-rose-500/10 border-rose-500/30";

  const capacityLabel = data.capacity || data.requestedSize || "Dynamic";
  const accessMode = (data.accessModes && data.accessModes[0])
    ? data.accessModes[0].replace("ReadWriteOnce", "RWO").replace("ReadOnlyMany", "ROX").replace("ReadWriteMany", "RWX")
    : "RWO";

  return (
    <div
      className="group relative flex flex-col gap-1.5 p-2.5 rounded-xl border border-cyan-500/30 bg-[#141417] hover:border-cyan-400/60 shadow-lg shadow-cyan-950/20 transition-all duration-200 cursor-pointer min-w-[170px] max-w-[210px]"
      title={`PersistentVolumeClaim: ${data.name} (${phase})`}
    >
      {/* 4-Cardinal Dynamic Handles */}
      <Handle type="target" position={Position.Left} id="target-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Right} id="target-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Top} id="target-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      <Handle type="source" position={Position.Left} id="source-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Right} id="source-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Top} id="source-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      {/* Legacy Fallback Handles */}
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

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="p-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">
            <StorageIcon className="text-sm" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-mono font-bold text-zinc-100 truncate tracking-tight">
              {data.name}
            </span>
            <span className="text-[9px] font-mono text-zinc-500 truncate">
              {data.namespace || "default"}
            </span>
          </div>
        </div>

        <span className={`text-[8.5px] font-mono font-black px-1.5 py-0.5 rounded border uppercase tracking-wider shrink-0 ${phaseClass}`}>
          {phase}
        </span>
      </div>

      <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-800/80 text-[9px] font-mono text-zinc-400">
        <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-300 font-semibold" title="Allocated Storage Capacity">
          💾 {capacityLabel}
        </span>
        <span className="px-1 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400" title="Access Mode">
          {accessMode}
        </span>
        {data.storageClassName && (
          <span className="px-1 py-0.5 rounded bg-zinc-900/60 border border-zinc-800/60 text-zinc-400 truncate max-w-[65px]" title={`StorageClass: ${data.storageClassName}`}>
            {data.storageClassName}
          </span>
        )}
      </div>
    </div>
  );
}

K8sPVCNode.displayName = "K8sPVCNode";
