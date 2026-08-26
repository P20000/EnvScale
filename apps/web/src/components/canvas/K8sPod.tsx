import { Handle, Position } from '@xyflow/react';
import { MdViewInAr as Icon } from 'react-icons/md';
import { useTopologyStore } from '../../store/useTopologyStore';

export interface K8sPodData extends Record<string, unknown> {
  name: string;
  namespace: string;
  nodeName?: string;
  status: "Running" | "CrashLoopBackOff" | "Pending" | "ContainerCreating" | "Terminating" | "Terminated" | "Failed" | "Unknown" | "Succeeded" | "Completed";
  restarts: number;
  ip?: string;
  podIp?: string;
  createdAt?: string;
  cpuUsage?: string;
  memoryUsage?: string;
  cpuUsageMcores?: number;
  memoryUsageMiB?: number;
  ownerName?: string;
  ownerKind?: string;
  ownerUid?: string;
  labels?: Record<string, string>;
  containers?: unknown[];
}

export function K8sPodNode({ data }: { data: K8sPodData }) {
  const podStatus = data.status?.trim() || 'Unknown';
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const statusConfig = {
    Running: {
      dotClass: "bg-emerald-400 shadow-[0_0_12px_#10b981]",
      textClass: "text-zinc-200"
    },
    Succeeded: {
      dotClass: "bg-zinc-500",
      textClass: "text-zinc-400"
    },
    Completed: {
      dotClass: "bg-zinc-500",
      textClass: "text-zinc-400"
    },
    Pending: {
      dotClass: "bg-amber-400 animate-pulse",
      textClass: "text-amber-200/90"
    },
    ContainerCreating: {
      dotClass: "bg-amber-400 animate-pulse",
      textClass: "text-amber-200/90"
    },
    Terminating: {
      dotClass: "bg-fuchsia-500 animate-[pulse_2s_infinite]",
      textClass: "text-zinc-400"
    },
    Failed: {
      dotClass: "bg-rose-500 shadow-[0_0_10px_#f43f5e]",
      textClass: "text-rose-300"
    },
    Error: {
      dotClass: "bg-rose-500 shadow-[0_0_10px_#f43f5e]",
      textClass: "text-rose-300"
    },
    CrashLoopBackOff: {
      dotClass: "bg-red-600 animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] shadow-[0_0_14px_#dc2626]",
      textClass: "text-red-400 font-bold"
    },
    Unknown: {
      dotClass: "bg-zinc-700",
      textClass: "text-zinc-500"
    }
  };

  const currentConfig = statusConfig[podStatus as keyof typeof statusConfig] || statusConfig.Unknown;

  return (
    <div className="h-8 w-[208px] bg-[#09090b] border border-zinc-800/80 rounded-md px-2.5 flex items-center justify-between transition-colors hover:border-zinc-600 select-none group relative">
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
        <Icon className="text-zinc-400 text-sm shrink-0" />
        <span className={`text-xs font-mono font-semibold truncate max-w-[120px] ${currentConfig.textClass}`}>
          {data.name}
        </span>
      </div>

      <div className={`h-2 w-2 rounded-full shrink-0 ${currentConfig.dotClass}`} />
    </div>
  );
}
