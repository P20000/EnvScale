import { Handle, Position } from '@xyflow/react';
import { MdLayers as Icon } from 'react-icons/md';
import type { K8sPodData } from "./K8sPod";
import { useTopologyStore } from '../../store/useTopologyStore';

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
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
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
