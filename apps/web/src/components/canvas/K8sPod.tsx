import { MdViewInAr as Icon } from 'react-icons/md';

export interface K8sPodData extends Record<string, unknown> {
  name: string;
  namespace: string;
  nodeName?: string;
  status: "Running" | "CrashLoopBackOff" | "Pending" | "ContainerCreating" | "Terminating" | "Terminated" | "Failed" | "Unknown";
  restarts: number;
  ip?: string;
  cpuUsage?: string;
  memoryUsage?: string;
  ownerName?: string;
  ownerKind?: string;
  ownerUid?: string;
}

export function K8sPodNode({ data }: { data: K8sPodData }) {
  const isRunning = data.status?.toLowerCase() === 'running';

  return (
    <div className="h-8 w-[208px] bg-[#09090b] border border-zinc-800/80 rounded-md px-2.5 flex items-center justify-between transition-colors hover:border-zinc-600 select-none group">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="text-zinc-400 text-sm shrink-0" />
        <span className="text-xs font-mono font-semibold text-zinc-200 truncate max-w-[120px]">
          {data.name}
        </span>
      </div>

      {/* Standalone Semantic Status Dot Indicator */}
      <div 
        className={`h-2 w-2 rounded-full shrink-0 ${
          isRunning ? 'bg-emerald-400 shadow-[0_0_12px_#10b981]' : 'bg-amber-400 shadow-[0_0_12px_#f59e0b] animate-pulse'
        }`} 
      />
    </div>
  );
}
