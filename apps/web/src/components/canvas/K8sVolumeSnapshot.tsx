import { Handle, Position } from "@xyflow/react";
import { MdCameraAlt as Icon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { K8sVolumeSnapshotData } from "../../store/types/topologyTypes";

export function K8sVolumeSnapshotNode({ data }: { data: K8sVolumeSnapshotData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const isReady = Boolean(data.readyToUse);
  const readyText = isReady ? "Ready" : "Pending";
  const dotClass = isReady ? "bg-teal-400" : "bg-amber-400 animate-pulse";
  const statusClass = isReady ? "text-teal-300" : "text-amber-300";

  const sourcePvc = data.sourcePVCName || "—";
  const restoreSize = data.restoreSize || "Snapshot";

  return (
    <div className="h-[54px] w-[240px] border border-teal-900/60 bg-[#12161a] hover:border-teal-500/50 flex flex-col justify-between p-2 rounded-md select-none group transition-all relative shadow-sm">
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

      {/* Top row: Icon + Name + Ready Status */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-teal-400 shrink-0" />
          <span className="text-xs font-mono font-semibold text-zinc-100 truncate max-w-[145px]" title={data.name}>
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={`text-[10px] font-mono font-medium ${statusClass}`}>
            {readyText}
          </span>
          <div className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
        </div>
      </div>

      {/* Bottom row: Namespace / Source PVC + Restore Size */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
        <span className="truncate max-w-[120px]" title={`PVC: ${sourcePvc} (${data.namespace || "default"})`}>
          {sourcePvc !== "—" ? `src: ${sourcePvc}` : (data.namespace || "default")}
        </span>
        <span className="px-1.5 py-0.5 rounded border border-teal-500/30 bg-teal-500/10 text-teal-300 font-semibold text-[10px] shrink-0 truncate max-w-[70px]">
          {restoreSize}
        </span>
      </div>
    </div>
  );
}

K8sVolumeSnapshotNode.displayName = "K8sVolumeSnapshotNode";
