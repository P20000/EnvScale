import {
  MdCheckCircle as CheckCircle,
  MdError as ErrorIcon,
  MdHourglassEmpty as Hourglass,
  MdSync as SyncIcon,
  MdTimer as TimerIcon,
  MdPlayCircleFilled as PlayCircle,
} from "react-icons/md";
import type { K8sJobData } from "../../../store/types/topologyTypes";

export interface JobConditionItem {
  type: string;
  status: string;
  reason?: string;
  message?: string;
}

interface JobOverviewSectionProps {
  data: K8sJobData;
  nowMs: number;
}

export function JobOverviewSection({ data, nowMs }: JobOverviewSectionProps) {
  const statusStr = String(data.status || "Running");
  const isCompleted = statusStr === "Completed";
  const isFailed = statusStr === "Failed";
  const isRunning = statusStr === "Running" || (!isCompleted && !isFailed);

  const completions = typeof data.completions === "number" ? data.completions : 1;
  const succeeded = typeof data.succeeded === "number" ? data.succeeded : 0;
  const active = typeof data.active === "number" ? data.active : 0;
  const failed = typeof data.failed === "number" ? data.failed : 0;
  const parallelism = typeof data.parallelism === "number" ? data.parallelism : 1;
  const conditions = (data.conditions as JobConditionItem[] | undefined) || [];
  const pct = Math.min(100, Math.round((succeeded / completions) * 100));

  const formatTimestamp = (ts?: unknown): string => {
    if (!ts || typeof ts !== "string") return "N/A";
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const calculateDuration = (): string => {
    if (typeof data.duration === "string" && data.duration) return data.duration;
    if (!data.startTime || typeof data.startTime !== "string") return "N/A";
    const start = new Date(data.startTime).getTime();
    if (isNaN(start)) return "N/A";
    const end = (typeof data.completionTime === "string" && data.completionTime)
      ? new Date(data.completionTime).getTime()
      : nowMs;
    const diffSec = Math.max(0, Math.floor((end - start) / 1000));
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="space-y-3.5">
      {/* Job Header & Status */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <TimerIcon className="h-4 w-4 text-amber-400" />
            Batch Job Execution
          </h4>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border ${
              isCompleted
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : isFailed
                ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                : "border-blue-500/30 bg-blue-500/10 text-blue-300"
            }`}
          >
            {isCompleted && <CheckCircle className="h-3.5 w-3.5" />}
            {isFailed && <ErrorIcon className="h-3.5 w-3.5" />}
            {isRunning && <SyncIcon className="h-3.5 w-3.5 animate-spin" />}
            {statusStr}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-neutral-400 text-[11px]">Completions Progress</span>
            <span className="text-neutral-200 font-semibold text-[11px]">
              {succeeded} / {completions} pods ({pct}%)
            </span>
          </div>
          <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isCompleted
                  ? "bg-emerald-500"
                  : isFailed
                  ? "bg-rose-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Execution Metrics Grid */}
        <div className="grid grid-cols-2 gap-3 text-xs pt-1 border-t border-neutral-800/80">
          <div>
            <span className="block text-neutral-400 text-[10px]">Active Pods</span>
            <span className="font-mono text-neutral-200 font-semibold">{active}</span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Parallelism</span>
            <span className="font-mono text-neutral-200 font-semibold">{parallelism} concurrent</span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Failed Attempts</span>
            <span className={`font-mono font-semibold ${failed > 0 ? "text-rose-400" : "text-neutral-200"}`}>
              {failed}
            </span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Total Duration</span>
            <span className="font-mono text-amber-300 font-semibold">{calculateDuration()}</span>
          </div>
        </div>
      </div>

      {/* Execution Timeline */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <Hourglass className="h-3.5 w-3.5 text-neutral-400" />
          Execution Timeline
        </h4>
        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex justify-between items-center">
            <span className="text-neutral-400 flex items-center gap-1">
              <PlayCircle className="h-3 w-3 text-emerald-400" />
              Started At:
            </span>
            <span className="text-neutral-200">{formatTimestamp(data.startTime)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-neutral-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-blue-400" />
              Completed At:
            </span>
            <span className="text-neutral-200">
              {data.completionTime ? formatTimestamp(data.completionTime) : "Running..."}
            </span>
          </div>
        </div>
      </div>

      {/* Condition / Failure Messages */}
      {conditions.length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
            Job Conditions
          </h4>
          <div className="space-y-1.5">
            {conditions.map((cond: JobConditionItem, idx: number) => (
              <div
                key={idx}
                className="rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs font-mono space-y-1"
              >
                <div className="flex justify-between items-center">
                  <span className="text-neutral-300 font-semibold">{cond.type}</span>
                  <span className="text-[10px] text-neutral-400">{cond.status}</span>
                </div>
                {cond.reason && (
                  <div className="text-[11px] text-amber-300">{cond.reason}</div>
                )}
                {cond.message && (
                  <div className="text-[10px] text-neutral-400 leading-snug">{cond.message}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

