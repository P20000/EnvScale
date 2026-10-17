import { Handle, Position } from '@xyflow/react';
import { MdLayers as Icon, MdSync as SyncIcon } from 'react-icons/md';
import type { K8sPodData } from "./K8sPod";
import { useUIStore } from '../../store/useUIStore';
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
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";
  const rollout = data.rolloutInfo;
  const isRolling = rollout?.isRollingUpdate;
  const isStandalone = rollout?.isStandaloneReplicaSet;

  return (
    <div className={`h-11 w-[260px] border bg-[#191B20] flex items-center justify-between px-3 rounded-md select-none group hover:border-[#424750] transition-colors relative ${
      isRolling
        ? 'border-[#F4C26B]/60 bg-[#23262D]'
        : isStandalone
        ? 'border-[#D0BCFF]/50'
        : 'border-[#30343B]'
    }`}>
      {/* 4-Cardinal Dynamic Handles */}
      <Handle type="target" position={Position.Left} id="target-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Right} id="target-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Top} id="target-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      <Handle type="source" position={Position.Left} id="source-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Right} id="source-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Top} id="source-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      {/* Legacy Fallback Handles */}
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
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 flex items-center gap-1">
          <SyncIcon size={12} className="animate-spin" />
          RS-{rollout.oldRevision?.hash || "old"}➔{rollout.newRevision?.hash || "new"}
        </span>
      ) : isStandalone ? (
        <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300">
          Standalone RS
        </span>
      ) : (
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold ${
          isHealthy 
            ? 'text-[#6DD6A8] bg-[#6DD6A8]/15' 
            : 'text-[#F4C26B] bg-[#F4C26B]/15'
        }`}>
          {ready}/{total}
        </span>
      )}
    </div>
  );
}
