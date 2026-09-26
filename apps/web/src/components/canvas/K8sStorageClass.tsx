import { Handle, Position } from "@xyflow/react";
import { MdLayers as Icon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { K8sStorageClassData } from "../../store/types/topologyTypes";

export function K8sStorageClassNode({ data }: { data: K8sStorageClassData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const provisioner = data.provisioner || "kubernetes.io/no-provisioner";
  const reclaimPolicy = data.reclaimPolicy || "Delete";
  const bindingMode = data.volumeBindingMode || "Immediate";

  return (
    <div className="h-[54px] w-[240px] border border-indigo-900/60 bg-[#12161a] hover:border-indigo-500/50 flex flex-col justify-between p-2 rounded-md select-none group transition-all relative shadow-sm">
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

      {/* Top row: Icon + Name + Reclaim Policy */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-indigo-400 shrink-0" />
          <span className="text-xs font-mono font-semibold text-zinc-100 truncate max-w-[145px]" title={data.name}>
            {data.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-mono font-medium text-indigo-300">
            {reclaimPolicy}
          </span>
          <div className="h-2 w-2 rounded-full shrink-0 bg-indigo-400" />
        </div>
      </div>

      {/* Bottom row: Provisioner (truncated) + Binding Mode / Expansion Badge */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
        <span className="truncate max-w-[120px]" title={provisioner}>
          {provisioner}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {data.allowVolumeExpansion && (
            <span
              className="px-1 py-0.2 rounded bg-neutral-900 border border-neutral-800 text-neutral-400 text-[9px]"
              title="Allow Volume Expansion"
            >
              Expand
            </span>
          )}
          <span
            className="px-1.5 py-0.5 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 font-semibold text-[10px] truncate max-w-[70px]"
            title={bindingMode}
          >
            {bindingMode === "WaitForFirstConsumer" ? "WaitFirst" : bindingMode}
          </span>
        </div>
      </div>
    </div>
  );
}

K8sStorageClassNode.displayName = "K8sStorageClassNode";
