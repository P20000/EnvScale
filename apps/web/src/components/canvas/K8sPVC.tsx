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

  const capacityLabel = data.capacity || data.requestedSize || "Dynamic";
  const accessMode = (data.accessModes && data.accessModes[0])
    ? data.accessModes[0].replace("ReadWriteOnce", "RWO").replace("ReadOnlyMany", "ROX").replace("ReadWriteMany", "RWX")
    : "RWO";

  return (
    <div
      className="group relative flex flex-col gap-1.5 p-2.5 rounded-xl border border-[#80DEEA]/40 bg-[#191B20] hover:border-[#80DEEA]/80 transition-all duration-200 cursor-pointer min-w-[170px] max-w-[210px]"
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
          <div className="p-1 rounded-md bg-[#80DEEA]/10 border border-[#80DEEA]/20 text-[#80DEEA] shrink-0">
            <StorageIcon className="text-sm" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-mono font-bold text-[#E6E1E5] truncate tracking-tight">
              {data.name}
            </span>
            <span className="text-[9px] font-mono text-[#92959D] truncate">
              {data.namespace || "default"}
            </span>
          </div>
        </div>

        <span className={`text-[8.5px] font-mono font-black px-2 py-0.5 rounded-md uppercase tracking-wider shrink-0 ${
          isBound
            ? "text-[#6DD6A8] bg-[#6DD6A8]/15"
            : isPending
            ? "text-[#F4C26B] bg-[#F4C26B]/15"
            : "text-[#111318] bg-[#fc3f3f] font-bold"
        }`}>
          {phase}
        </span>
      </div>

      <div className="flex items-center gap-1.5 pt-1.5 border-t border-[#30343B] text-[9px] font-mono text-[#9AA0AA]">
        <span className="px-1.5 py-0.5 rounded-md bg-[#23262D] text-[#80DEEA] font-semibold" title="Allocated Storage Capacity">
          💾 {capacityLabel}
        </span>
        <span className="px-1.5 py-0.5 rounded-md bg-[#23262D] text-[#9AA0AA]" title="Access Mode">
          {accessMode}
        </span>
        {data.storageClassName && (
          <span className="px-1.5 py-0.5 rounded-md bg-[#23262D]/60 text-[#777D87] truncate max-w-[65px]" title={`StorageClass: ${data.storageClassName}`}>
            {data.storageClassName}
          </span>
        )}
      </div>
    </div>
  );
}

K8sPVCNode.displayName = "K8sPVCNode";
