import { MdTimer, MdPauseCircleOutline } from "react-icons/md";
import type { K8sCronJobData } from "../../store/types/topologyTypes";

function formatRelativeTime(timestamp?: string): string {
  if (!timestamp) return "Never run";
  const date = new Date(timestamp);
  const time = date.getTime();
  if (isNaN(time)) return "Never run";
  const diffMs = Math.max(0, Date.now() - time);
  const m = Math.floor(diffMs / (1000 * 60));
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `Last run: ${d}d ago`;
  if (h > 0) return `Last run: ${h}h ago`;
  if (m > 0) return `Last run: ${m}m ago`;
  return "Last run: just now";
}

export function K8sCronJobNode({ data }: { data: K8sCronJobData }) {
  const activeCount = Number(data.activeJobsCount || 0);
  const isSuspended = Boolean(data.suspend);
  const isActive = activeCount > 0 && !isSuspended;

  const schedule = data.schedule || "0 * * * *";
  const relativeLastRun = formatRelativeTime(data.lastScheduleTime || data.lastSuccessfulTime);

  return (
    <div
      className={`w-[260px] h-[58px] p-2.5 bg-zinc-900/90 border rounded-lg shadow-sm flex flex-col justify-between cursor-pointer transition-colors select-none relative overflow-hidden ${
        isSuspended
          ? "border-zinc-800/80 opacity-75"
          : isActive
          ? "border-amber-800/80 bg-zinc-900/95"
          : "border-zinc-800 hover:border-zinc-700"
      }`}
    >
      {/* Material Design 3 Linear Progress Border Animation when running */}
      {isActive && (
        <div className="m3-progress-line">
          <div className="m3-progress-line-bar" />
        </div>
      )}

      {/* Row 1: Primary Header (Icon + Name | Status Badge) */}
      <div className="flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <MdTimer
            className={`w-3.5 h-3.5 shrink-0 ${
              isSuspended
                ? "text-zinc-500"
                : isActive
                ? "text-amber-400"
                : "text-zinc-400"
            }`}
          />
          <span className="text-xs font-semibold text-zinc-100 tracking-tight truncate max-w-[130px]">
            {data.name}
          </span>
        </div>

        <div>
          {isSuspended ? (
            <span className="h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium border bg-zinc-800/80 text-zinc-500 border-zinc-700/40">
              <MdPauseCircleOutline size={10} />
              SUSPENDED
            </span>
          ) : isActive ? (
            <span className="h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium border bg-amber-950/40 text-amber-300 border-amber-800/50">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              RUNNING ({activeCount})
            </span>
          ) : (
            <span className="h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium border bg-zinc-800/80 text-zinc-300 border-zinc-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              IDLE
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Secondary Metadata (Schedule | Contextual Timestamp) */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span className="text-zinc-400 font-mono text-[10px]">{schedule}</span>
        <span className="text-zinc-500 font-mono text-[10px]">{relativeLastRun}</span>
      </div>
    </div>
  );
}

K8sCronJobNode.displayName = "K8sCronJobNode";
