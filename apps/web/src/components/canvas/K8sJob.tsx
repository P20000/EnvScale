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
  const isCompleted = succeeded >= completions && !isRunning;

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return "< 1s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const statusBadge = isFailed ? (
    <div className="h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-mono text-[10px] font-medium border bg-rose-950/40 text-rose-300 border-rose-800/50 shrink-0">
      <MdErrorOutline className="w-3 h-3 text-rose-400" />
      <span>FAILED</span>
    </div>
  ) : isRunning ? (
    <div className="h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-mono text-[10px] font-medium border bg-amber-950/40 text-amber-300 border-amber-800/50 shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
      <span>RUNNING</span>
    </div>
  ) : (
    <div className="h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-mono text-[10px] font-medium border bg-emerald-950/40 text-emerald-300 border-emerald-800/50 shrink-0">
      <MdCheckCircle className="w-3 h-3 text-emerald-400" />
      <span>{succeeded}/{completions} DONE</span>
    </div>
  );

  return (
    <div
      className={`w-[260px] h-[58px] p-2.5 rounded-lg bg-zinc-900/90 border shadow-sm flex flex-col justify-between cursor-pointer transition-colors select-none ${
        isRunning
          ? "border-amber-500/60 bg-zinc-900/95"
          : isFailed
          ? "border-rose-700/60 hover:border-rose-600"
          : isCompleted
          ? "border-emerald-800/40 hover:border-emerald-700"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      {/* Row 1 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <MdOutlinePlayCircle
            className={`w-3.5 h-3.5 shrink-0 ${
              isRunning ? "text-amber-400 animate-spin" : isFailed ? "text-rose-400" : "text-emerald-400"
            }`}
          />
          <span className="text-xs font-semibold text-zinc-100 tracking-tight truncate max-w-[130px]" title={job?.name}>
            {job?.name || 'batch-job'}
          </span>
        </div>
        {statusBadge}
      </div>

      {/* Row 2 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span className="text-zinc-400">BATCH JOB</span>
        <span className={isRunning ? "text-amber-300/90 font-medium" : "text-zinc-400"}>
          {isRunning ? `Active (${active})` : `Duration: ${formatDuration(job?.durationSeconds)}`}
        </span>
      </div>
    </div>
  );
};

K8sJobNode.displayName = "K8sJobNode";
