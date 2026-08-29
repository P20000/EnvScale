import React from 'react';
import { type NodeProps } from '@xyflow/react';
import { MdOutlineShield } from 'react-icons/md';
import type { K8sDaemonSetData } from '../../store/types/topologyTypes';

export const K8sDaemonSetNode: React.FC<NodeProps> = ({ data }) => {
  const ds = data as unknown as K8sDaemonSetData;
  const ready = ds?.numberReady ?? 0;
  const desired = ds?.desiredNumberScheduled ?? 0;

  return (
    <div className="w-[260px] h-[58px] p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 shadow-sm flex flex-col justify-between cursor-pointer transition-colors select-none">
      {/* Row 1 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <MdOutlineShield className="w-3.5 h-3.5 text-zinc-400 shrink-0"/>
          <span className="text-xs font-semibold text-zinc-100 tracking-tight truncate max-w-[130px]">
            {ds?.name || 'daemonset'}
          </span>
        </div>
        <div className="h-5 px-2 py-0.5 rounded-md inline-flex items-center font-mono text-[10px] font-medium border bg-zinc-800/80 border-zinc-700/50 text-zinc-300 shrink-0">
          {ready}/{desired} Nodes
        </div>
      </div>

      {/* Row 2 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span className="text-zinc-400">DAEMONSET</span>
        <span>HOST AGENT</span>
      </div>
    </div>
  );
};

K8sDaemonSetNode.displayName = "K8sDaemonSetNode";
