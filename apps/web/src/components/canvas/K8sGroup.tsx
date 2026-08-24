import { Handle, Position } from '@xyflow/react';

export interface K8sGroupData extends Record<string, unknown> {
  name: string;
}

export function K8sGroupNode({ data }: { data: K8sGroupData }) {
  return (
    <div className="w-full h-full min-w-[280px] min-h-[80px] bg-[#18181b] border-2 border-zinc-800/80 shadow-none rounded-xl p-4 flex flex-col gap-2.5 relative pointer-events-none">
      {/* Handles for structural graph routing */}
      <Handle type="target" position={Position.Left} id="left-target" isConnectable={false} className="!w-2 !h-2 !bg-zinc-600 !border-zinc-500 rounded-full" />
      <Handle type="source" position={Position.Right} id="right-source" isConnectable={false} className="!w-2 !h-2 !bg-zinc-600 !border-zinc-500 rounded-full" />

      <div className="text-xs font-mono font-bold tracking-widest text-zinc-100 uppercase select-none">
        {data.name}
      </div>
      {/* React Flow injects children inside this coordinate space automatically */}
    </div>
  );
}

K8sGroupNode.displayName = "K8sGroupNode";
