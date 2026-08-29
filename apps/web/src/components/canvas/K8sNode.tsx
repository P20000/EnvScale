import { Handle, Position } from '@xyflow/react';
import { MdDns as Icon } from 'react-icons/md';
import { useUIStore } from '../../store/useUIStore';

export interface K8sNodeData extends Record<string, unknown> {
  name: string;
  ip: string;
  osImage?: string;
  cpuCapacity?: string;
  memoryCapacity?: string;
  cpuPct: number;
  memoryPct: number;
  status: "Ready" | "NotReady" | "Running" | "Warning" | "Error" | "Inactive";
}

export function K8sWorkerNode({ data }: { data: K8sNodeData }) {
  const isHealthy = data.status === "Ready" || data.status === "Running";
  const isError = data.status === "NotReady" || data.status === "Error";
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  return (
    <div className="h-11 w-[240px] border border-zinc-800 bg-[#141417] flex items-center justify-between px-3 rounded-md select-none group hover:border-zinc-700 transition-colors relative">
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

      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-zinc-400 shrink-0" />
        <span className="text-xs font-mono font-medium truncate text-zinc-300 max-w-[140px]">
          {data.name}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono text-zinc-500">
          {data.cpuPct}% CPU
        </span>
        <div 
          className={`h-2 w-2 rounded-full ${
            isHealthy 
              ? 'bg-emerald-500' 
              : isError 
              ? 'bg-rose-500'
              : 'bg-amber-500'
          }`} 
        />
      </div>
    </div>
  );
}

K8sWorkerNode.displayName = "K8sWorkerNode";
