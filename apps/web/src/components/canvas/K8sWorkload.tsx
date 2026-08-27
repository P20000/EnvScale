import { Handle, Position } from '@xyflow/react';
import { MdLayers as Icon, MdSync as SyncIcon } from 'react-icons/md';
import type { K8sPodData } from "./K8sPod";
import { useTopologyStore } from '../../store/useTopologyStore';
import type { RolloutInfo } from '../../store/helpers/rolloutHelpers';

export interface K8sWorkloadData extends Record<string, unknown> {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  workloadType: "Deployment" | "ReplicaSet" | "StatefulSet" | "JobGroup" | "WorkloadGroup";
  isAggregated?: boolean;
  isExpanded?: boolean;
  pods?: K8sPodData[];
  rolloutInfo?: RolloutInfo | null;
  onToggleExpand?: (workloadName: string) => void;
}

export function K8sWorkloadNode({ data }: { data: K8sWorkloadData }) {
  const ready = data.readyReplicas || 0;
  const total = data.replicas || 0;
  const isHealthy = ready === total && total > 0;
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";
  const rollout = data.rolloutInfo;
  const isRolling = rollout?.isRollingUpdate;
  const isStandalone = rollout?.isStandaloneReplicaSet;

  return (
    <div className={`h-11 w-[260px] border bg-[#141417] flex items-center justify-between px-3 rounded-md select-none group hover:border-zinc-700 transition-colors relative ${
      isRolling
        ? 'border-amber-500/60 bg-amber-950/20 animate-pulse'
        : isStandalone
        ? 'border-purple-500/50'
        : 'border-zinc-800'
    }`}>
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
        <Icon size={16} className={isRolling ? "text-amber-400" : "text-zinc-400"} />
        <span className="text-xs font-mono font-medium truncate text-zinc-300 max-w-[110px]">
          {data.name}
        </span>
      </div>

      {isRolling ? (
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 flex items-center gap-1">
          <SyncIcon size={12} className="animate-spin" />
          RS-{rollout.oldRevision?.hash || "old"}➔{rollout.newRevision?.hash || "new"}
        </span>
      ) : isStandalone ? (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300">
          Standalone RS
        </span>
      ) : (
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
          isHealthy 
            ? 'text-emerald-400 border-emerald-500/10 bg-emerald-500/5' 
            : 'text-amber-400 border-amber-500/10 bg-amber-500/5'
        }`}>
          {ready}/{total}
        </span>
      )}
    </div>
  );
}
