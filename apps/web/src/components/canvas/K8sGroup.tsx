import { Handle, Position } from '@xyflow/react';
import { useUIStore } from '../../store/useUIStore';
import type { RolloutInfo } from '../../store/helpers/rolloutHelpers';
import { MdSync as SyncIcon } from 'react-icons/md';

export interface K8sGroupData extends Record<string, unknown> {
  name: string;
  namespace?: string;
  rolloutInfo?: RolloutInfo | null;
}

export function K8sGroupNode({ data }: { data: K8sGroupData }) {
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";
  const rollout = data.rolloutInfo;
  const isRolling = rollout?.isRollingUpdate;
  const isStandalone = rollout?.isStandaloneReplicaSet;

  return (
    <div className={`w-full h-full min-w-[280px] min-h-[80px] bg-[#18181b] border-2 shadow-none rounded-xl p-4 flex flex-col gap-2.5 relative pointer-events-none transition-colors ${
      isRolling
        ? 'border-amber-500/60 bg-[#1c1917]'
        : isStandalone
        ? 'border-purple-500/50'
        : 'border-zinc-800/80'
    }`}>
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

      <div className="flex items-center justify-between gap-2 select-none">
        <div className="text-xs font-mono font-bold tracking-widest text-zinc-100 uppercase">
          {data.name}
        </div>

        {isRolling && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 text-[10px] font-mono">
            <SyncIcon className="h-3 w-3 animate-spin shrink-0" />
            <span>
              RS-{rollout.oldRevision?.hash || "old"} ({rollout.oldRevision?.readyReplicas ?? 0}/{rollout.oldRevision?.replicas ?? 0}) ➔ RS-{rollout.newRevision?.hash || "new"} ({rollout.newRevision?.readyReplicas ?? 0}/{rollout.newRevision?.replicas ?? 0})
            </span>
          </div>
        )}

        {isStandalone && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-purple-500/40 bg-purple-500/10 text-purple-300">
            Standalone ReplicaSet
          </span>
        )}
      </div>
    </div>
  );
}

K8sGroupNode.displayName = "K8sGroupNode";
