import React from 'react';
import { type NodeProps } from '@xyflow/react';
import { MdTimer } from 'react-icons/md';
import type { K8sCronJobData } from '../../store/types/topologyTypes';

/**
 * Translates standard 5-part cron syntax into concise human-readable cadence ("every X")
 */
function formatCronInterval(cronStr: string): string {
  if (!cronStr) return 'every 1m';
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length < 5) return 'scheduled';

  const [minute, hour, dom, month, dow] = parts;

  // Every N minutes: */1 * * * * or * * * * *
  if (minute === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'every 1m';
  if (minute.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const mins = minute.slice(2);
    return `every ${mins}m`;
  }

  // Hourly at minute N: 0 * * * * or 15 * * * *
  if (!minute.includes('/') && !minute.includes('*') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return 'every 1h';
  }

  // Every N hours: 0 */2 * * *
  if (hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') {
    const hrs = hour.slice(2);
    return `every ${hrs}h`;
  }

  // Daily: 0 0 * * * or 0 12 * * *
  if (dom === '*' && month === '*' && dow === '*' && !hour.includes('*')) {
    return 'daily';
  }

  // Weekly: 0 0 * * 0
  if (dom === '*' && month === '*' && dow !== '*' && !dow.includes('/')) {
    return 'weekly';
  }

  // Monthly: 0 0 1 * *
  if (dom !== '*' && month === '*' && dow === '*') {
    return 'monthly';
  }

  return 'every 1m';
}

export const K8sCronJobNode: React.FC<NodeProps> = ({ data }) => {
  const cj = data as unknown as K8sCronJobData;
  const isActive = (cj?.activeJobsCount ?? 0) > 0;
  const schedule = cj?.schedule || '* * * * *';
  const intervalHuman = formatCronInterval(schedule);

  return (
    <div
      className="w-[260px] h-[56px] px-3 py-2 rounded-lg bg-[#191B20] border border-[#30343B] hover:border-[#424750] flex flex-col justify-between cursor-pointer transition-colors relative select-none group"
    >
      {/* Row 1: Identity & Active Tonal Status Chip */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${
            isActive
              ? "bg-[#284568] border-[#A8C7FA]/30 text-[#A8C7FA]"
              : "bg-[#23262D] border-[#30343B] text-[#9AA0AA]"
          }`}>
            <MdTimer className="w-3.5 h-3.5 shrink-0" />
          </div>
          <span className="text-xs font-semibold text-[#E6E1E5] tracking-tight truncate max-w-[120px]" title={cj?.name}>
            {cj?.name || 'cronjob'}
          </span>
        </div>

        {/* Option 2: M3 Tonal Status Chip with Radar Ping */}
        <div
          className={`h-5 px-2 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium leading-none shrink-0 ${
            isActive
              ? "bg-[#284568] text-[#D3E3FD]"
              : "bg-[#23262D] text-[#9AA0AA]"
          }`}
        >
          {isActive ? (
            <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A8C7FA] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#A8C7FA]" />
            </span>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#777D87]" />
          )}
          {isActive ? 'ACTIVE' : 'IDLE'}
        </div>
      </div>

      {/* Row 2: Schedule & Execution Cadence */}
      <div className="flex items-center justify-between text-[10px] font-mono leading-none">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[#C4C7C5] tracking-tight shrink-0 font-medium" title={`Cron: ${schedule}`}>
            {schedule}
          </span>
          <span
            className="px-1.5 py-[2px] rounded-md bg-[#284568]/50 text-[#D3E3FD] text-[9px] font-medium shrink-0 leading-none"
            title={`Cadence: ${intervalHuman}`}
          >
            {intervalHuman}
          </span>
        </div>
        <span className={isActive ? "text-[#A8C7FA] font-medium shrink-0" : "text-[#777D87] shrink-0"}>
          {isActive ? 'Running' : 'just now'}
        </span>
      </div>
    </div>
  );
};

K8sCronJobNode.displayName = "K8sCronJobNode";
