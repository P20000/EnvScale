import React from 'react';
import { type NodeProps } from '@xyflow/react';
import { MdCheckCircle, MdExpandMore } from 'react-icons/md';
import { useUIStore } from '../../store/useUIStore';

export interface CompletedJobsNodeData extends Record<string, unknown> {
  count: number;
}

export const K8sCompletedJobsNode: React.FC<NodeProps> = ({ data }) => {
  const nodeData = data as unknown as CompletedJobsNodeData;
  const count = nodeData?.count ?? 0;
  const setShowCompletedJobs = useUIStore((s) => s.setShowCompletedJobs);

  return (
    <div
      onClick={() => setShowCompletedJobs(true)}
      title="Click to expand completed jobs on canvas"
      className="w-[260px] h-[48px] px-3 py-2 rounded-lg bg-zinc-900/80 border border-dashed border-zinc-700/80 hover:border-emerald-500/50 hover:bg-zinc-900 shadow-sm flex items-center justify-between cursor-pointer transition-colors select-none group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <MdCheckCircle className="w-4 h-4 text-emerald-500/80 group-hover:text-emerald-400 shrink-0" />
        <div className="min-w-0">
          <span className="text-xs font-medium text-zinc-300 group-hover:text-zinc-100 truncate block">
            {count} Completed {count === 1 ? 'Job' : 'Jobs'}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 group-hover:text-emerald-400/90 transition-colors">
            Click to expand
          </span>
        </div>
      </div>

      <div className="h-6 w-6 rounded-md bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400 group-hover:text-zinc-200 group-hover:border-zinc-600 transition-colors shrink-0">
        <MdExpandMore className="w-4 h-4" />
      </div>
    </div>
  );
};

K8sCompletedJobsNode.displayName = "K8sCompletedJobsNode";
