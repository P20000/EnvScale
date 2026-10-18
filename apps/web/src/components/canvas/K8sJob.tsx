import React from 'react';
import { type NodeProps } from '@xyflow/react';
import { MdOutlinePlayCircle, MdCheckCircle, MdErrorOutline } from 'react-icons/md';
import type { K8sJobData } from '../../store/types/topologyTypes';

export const K8sJobNode: React.FC<NodeProps> = ({ data }) => {
  const job = data as unknown as K8sJobData;

  const succeeded = job?.succeeded ?? 0;
  const failed = job?.failed ?? 0;
  const active = job?.active ?? 0;
  const completions = job?.completions ?? 1;

  const isFailed = failed > 0 && active === 0;
  const isRunning = active > 0;

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return "< 1s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const statusBadge = isFailed ? (
    <div className="h-5 px-2 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-bold leading-none bg-[#fc3f3f] text-[#111318] shrink-0">
      <MdErrorOutline className="w-3 h-3 text-[#111318]" />
      <span>FAILED</span>
    </div>
  ) : isRunning ? (
    <div className="h-5 px-2 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium leading-none bg-[#284568] text-[#F4C26B] shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-[#F4C26B]" />
      <span>RUNNING</span>
    </div>
  ) : (
    <div className="h-5 px-2 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium leading-none bg-[#1A3326] text-[#6DD6A8] shrink-0">
      <MdCheckCircle className="w-3 h-3 text-[#6DD6A8]" />
      <span>{succeeded}/{completions} DONE</span>
    </div>
  );

  return (
    <div
      className="w-[260px] h-[56px] px-3 py-2 rounded-lg bg-[#191B20] border border-[#30343B] hover:border-[#424750] flex flex-col justify-between cursor-pointer transition-colors select-none group"
    >
      {/* Row 1: Identity & Execution Status Chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${
            isRunning
              ? "bg-[#284568] border-[#F4C26B]/30 text-[#F4C26B]"
              : isFailed
              ? "bg-[#410E0B] border-[#F2B8B5]/30 text-[#F2B8B5]"
              : "bg-[#1A3326] border-[#6DD6A8]/30 text-[#6DD6A8]"
          }`}>
            <MdOutlinePlayCircle
              className={`w-3.5 h-3.5 shrink-0 ${isRunning ? "animate-spin" : ""}`}
            />
          </div>
          <span className="text-xs font-semibold text-[#E6E1E5] tracking-tight truncate max-w-[120px]" title={job?.name}>
            {job?.name || 'batch-job'}
          </span>
        </div>
        {statusBadge}
      </div>

      {/* Row 2: Workload Spec & Duration */}
      <div className="flex items-center justify-between text-[10px] font-mono text-[#9AA0AA] leading-none">
        <span className="tracking-wider">BATCH JOB</span>
        <span className={isRunning ? "text-[#F4C26B] font-medium" : "text-[#777D87]"}>
          {isRunning ? `Active (${active})` : `Duration: ${formatDuration(job?.durationSeconds)}`}
        </span>
      </div>
    </div>
  );
};

K8sJobNode.displayName = "K8sJobNode";
