import { Handle, Position } from '@xyflow/react';
import { MdDns as Icon } from 'react-icons/md';
import { useUIStore } from '../../store/useUIStore';

export interface DaemonAgentInfo {
  name: string;
  namespace?: string;
  ready: boolean;
}

export interface K8sNodeData extends Record<string, unknown> {
  name: string;
  ip: string;
  osImage?: string;
  cpuCapacity?: string;
  memoryCapacity?: string;
  cpuPct: number;
  memoryPct: number;
  status: "Ready" | "NotReady" | "Running" | "Warning" | "Error" | "Inactive";
  daemonAgents?: DaemonAgentInfo[];
}

export function K8sWorkerNode({ data }: { data: K8sNodeData }) {
  const isHealthy = data.status === "Ready" || data.status === "Running";
  const isError = data.status === "NotReady" || data.status === "Error";
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";
  return (
    <div className="w-[260px] h-[56px] px-3 py-2 rounded-lg border border-[#30343B] bg-[#191B20] hover:border-[#424750] flex flex-col justify-between cursor-pointer transition-colors select-none relative group">
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

      {/* Row 1: Identity & Health Status Chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-[#23262D] border border-[#30343B] flex items-center justify-center shrink-0 text-[#C4C7C5]">
            <Icon size={14} />
          </div>
          <span className="text-xs font-semibold text-[#E6E1E5] tracking-tight truncate max-w-[120px]" title={data.name}>
            {data.name}
          </span>
        </div>

        <div
          className={`h-5 px-2 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-bold leading-none shrink-0 ${
            isHealthy
              ? "bg-[#6DD6A8] text-[#111318]"
              : isError
              ? "bg-[#fc3f3f] text-[#111318]"
              : "bg-[#F4C26B] text-[#111318]"
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#111318]" />
          {isHealthy ? "READY" : isError ? "NOT READY" : "WARNING"}
        </div>
      </div>

      {/* Row 2: Node Role & Telemetry Metrics */}
      <div className="flex items-center justify-between text-[10px] font-mono text-[#9AA0AA] leading-none">
        <span className="tracking-wider">CONTROL PLANE</span>
        <div className="flex items-center gap-1.5">
          {data.daemonAgents && data.daemonAgents.length > 0 && (
            <>
              <span className="text-[#D0BCFF] font-medium" title={`Resident DaemonSets: ${data.daemonAgents.map((a) => a.name).join(", ")}`}>
                {data.daemonAgents.length} DS
              </span>
              <span className="text-[#5C616B]">•</span>
            </>
          )}
          <span className="text-[#C4C7C5]">{data.cpuPct}% CPU</span>
        </div>
      </div>
    </div>
  );
}

K8sWorkerNode.displayName = "K8sWorkerNode";
