import { Handle, Position } from '@xyflow/react';
import { useTopologyStore } from '../../store/useTopologyStore';

export interface K8sGroupData extends Record<string, unknown> {
  name: string;
}

export function K8sGroupNode({ data }: { data: K8sGroupData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  return (
    <div className="w-full h-full min-w-[280px] min-h-[80px] bg-[#18181b] border-2 border-zinc-800/80 shadow-none rounded-xl p-4 flex flex-col gap-2.5 relative pointer-events-none">
      {/* Handles for structural graph routing */}
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

      <div className="text-xs font-mono font-bold tracking-widest text-zinc-100 uppercase select-none">
        {data.name}
      </div>
    </div>
  );
}

K8sGroupNode.displayName = "K8sGroupNode";
