import React from 'react';
import { type NodeProps } from '@xyflow/react';
import { MdTimer } from 'react-icons/md';
import type { K8sCronJobData } from '../../store/types/topologyTypes';

export const K8sCronJobNode: React.FC<NodeProps> = ({ data }) => {
  const cj = data as unknown as K8sCronJobData;
  const isActive = (cj?.activeJobsCount ?? 0) > 0;
  const schedule = cj?.schedule || '* * * * *';

  return (
    <div
      className={`w-[260px] h-[58px] p-2.5 rounded-lg bg-zinc-900/90 border shadow-sm flex flex-col justify-between cursor-pointer transition-colors relative overflow-hidden select-none ${
        isActive
          ? "border-amber-500/60 bg-zinc-900/95 cronjob-active-glow"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      {/* Active Glowing Border Beam Loader */}
      {isActive && (
        <div className="cronjob-border-beam-container" role="progressbar" aria-label="CronJob Active Border Beam Loader">
          <div className="cronjob-border-beam-spin" />
        </div>
      )}

      {/* Row 1 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <MdTimer className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-amber-400" : "text-zinc-400"}`}/>
          <span className="text-xs font-semibold text-zinc-100 tracking-tight truncate max-w-[130px]">
            {cj?.name || 'cronjob'}
          </span>
        </div>
        <div
          className={`h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium border shrink-0 ${
            isActive
              ? "bg-amber-950/40 text-amber-300 border-amber-800/50"
              : "bg-zinc-800/80 text-zinc-300 border-zinc-700/50"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-amber-400" : "bg-emerald-500"}`} />
          {isActive ? 'ACTIVE' : 'IDLE'}
        </div>
      </div>

      {/* Row 2 */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span className="text-zinc-400">{schedule}</span>
        <span className={isActive ? "text-amber-300/90 font-medium" : ""}>
          {isActive ? 'Running now' : 'Last run: just now'}
        </span>
      </div>
    </div>
  );
};

K8sCronJobNode.displayName = "K8sCronJobNode";
