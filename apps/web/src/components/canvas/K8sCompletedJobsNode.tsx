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
      className="w-[260px] h-[56px] px-3 py-2 rounded-lg bg-[#191B20] border border-[#30343B] hover:border-[#424750] flex items-center justify-between cursor-pointer transition-colors select-none group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-md bg-[#1A3326] border border-[#6DD6A8]/30 flex items-center justify-center text-[#6DD6A8] shrink-0">
          <MdCheckCircle className="w-4 h-4 text-[#6DD6A8]" />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-semibold text-[#E6E1E5] group-hover:text-white tracking-tight truncate block transition-colors">
            {count} Completed {count === 1 ? 'Job' : 'Jobs'}
          </span>
          <span className="text-[10px] font-mono text-[#9AA0AA] group-hover:text-[#6DD6A8] transition-colors leading-tight block">
            Click to expand
          </span>
        </div>
      </div>

      <div className="w-6 h-6 rounded-md bg-[#23262D] border border-[#30343B] group-hover:border-[#424750] group-hover:bg-[#2B2F36] flex items-center justify-center text-[#9AA0AA] group-hover:text-[#E6E1E5] transition-colors shrink-0">
        <MdExpandMore className="w-4 h-4" />
      </div>
    </div>
  );
};

K8sCompletedJobsNode.displayName = "K8sCompletedJobsNode";
