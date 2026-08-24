import { Handle, Position } from '@xyflow/react';
import { MdLayers as Icon } from 'react-icons/md';
import type { K8sPodData } from "./K8sPod";

export interface K8sWorkloadData extends Record<string, unknown> {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  workloadType: "Deployment" | "ReplicaSet" | "StatefulSet" | "JobGroup" | "WorkloadGroup";
  isAggregated?: boolean;
  isExpanded?: boolean;
  pods?: K8sPodData[];
  onToggleExpand?: (workloadName: string) => void;
}

export function K8sWorkloadNode({ data }: { data: K8sWorkloadData }) {
  const ready = data.readyReplicas || 0;
  const total = data.replicas || 0;
  const isHealthy = ready === total && total > 0;

  return (
    <div className="h-11 w-[240px] border border-zinc-800 bg-[#141417] flex items-center justify-between px-3 rounded-md select-none group hover:border-zinc-700 transition-colors">
      <Handle type="target" position={Position.Left} id="left-target" isConnectable={false} className="!w-1.5 !h-1.5 !bg-zinc-700 !border-zinc-900 rounded-full" />
      <Handle type="source" position={Position.Right} id="right-source" isConnectable={false} className="!w-1.5 !h-1.5 !bg-zinc-700 !border-zinc-900 rounded-full" />

      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-zinc-400 shrink-0" />
        <span className="text-xs font-mono font-medium truncate text-zinc-300 max-w-[140px]">
          {data.name}
        </span>
      </div>

      {/* High-Density Structural Replica Token Counter */}
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
        isHealthy 
          ? 'text-emerald-400 border-emerald-500/10 bg-emerald-500/5' 
          : 'text-amber-400 border-amber-500/10 bg-amber-500/5'
      }`}>
        {ready}/{total}
      </span>
    </div>
  );
}
