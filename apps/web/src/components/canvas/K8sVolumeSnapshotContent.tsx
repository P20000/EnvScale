import { Handle, Position } from "@xyflow/react";
import { MdOutlineSnippetFolder as Icon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { K8sVolumeSnapshotContentData } from "../../store/types/topologyTypes";

export function K8sVolumeSnapshotContentNode({ data }: { data: K8sVolumeSnapshotContentData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const deletionPolicy = data.deletionPolicy || "Delete";
  const driver = data.driver || "csi";
  const handle = data.snapshotHandle ? String(data.snapshotHandle).slice(-10) : "content";

  return (
    <div className="h-[54px] w-[240px] border border-slate-700/60 bg-[#12161a] hover:border-slate-400/50 flex flex-col justify-between p-2 rounded-md select-none group transition-all relative shadow-sm">
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

      {/* Top row: Icon + Name + Deletion Policy */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-slate-400 shrink-0" />
          <span className="text-xs font-mono font-semibold text-zinc-100 truncate max-w-[145px]" title={data.name}>
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-mono font-medium text-slate-300">
            {deletionPolicy}
          </span>
          <div className="h-2 w-2 rounded-full shrink-0 bg-slate-400" />
        </div>
      </div>

      {/* Bottom row: Driver + Snapshot handle */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
        <span className="truncate max-w-[120px]" title={driver}>
          {driver}
        </span>
        <span
          className="px-1.5 py-0.5 rounded border border-slate-600/30 bg-slate-600/10 text-slate-300 font-semibold text-[10px] shrink-0 truncate max-w-[80px]"
          title={data.snapshotHandle || ""}
        >
          {handle}
        </span>
      </div>
    </div>
  );
}

K8sVolumeSnapshotContentNode.displayName = "K8sVolumeSnapshotContentNode";
