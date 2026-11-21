import { MdFavorite as HeartbeatIcon, MdCheckCircle as CheckIcon, MdWarning as WarningIcon } from "react-icons/md";
import type { ProbeSpecInfo } from "../../../store/types/topologyTypes";

interface HealthProbesSectionProps {
  liveness?: ProbeSpecInfo | null;
  readiness?: ProbeSpecInfo | null;
  isReady?: boolean;
}

export function HealthProbesSection({
  liveness,
  readiness,
  isReady = true,
}: HealthProbesSectionProps) {
  if (!liveness && !readiness) return null;

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-neutral-900/50 p-3.5 space-y-3 font-mono">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5 font-sans">
          <HeartbeatIcon className="h-4 w-4 text-emerald-400" />
          Container Health Probes
        </h4>
        <span
          className={`text-[9.5px] px-2 py-0.5 rounded flex items-center gap-1 font-semibold ${
            isReady
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              : "bg-rose-500/10 text-rose-400 border border-rose-500/30"
          }`}
        >
          {isReady ? <CheckIcon className="text-xs" /> : <WarningIcon className="text-xs" />}
          {isReady ? "Probes Passing" : "Probe Check Unready"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* Liveness Probe Column */}
        <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
              Liveness Probe
            </span>
            {liveness ? (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            ) : (
              <span className="text-[9px] text-neutral-600">None</span>
            )}
          </div>

          {liveness ? (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-neutral-200 font-semibold truncate text-emerald-300">
                {liveness.type.toUpperCase()}{" "}
                {liveness.path ? `${liveness.path}` : ""}{" "}
                {liveness.port ? `:${liveness.port}` : ""}
              </div>
              <div className="text-[10px] text-neutral-400 space-y-0.5">
                <div>Interval: <span className="text-neutral-300">every {liveness.periodSeconds}s</span></div>
                <div>Initial Delay: <span className="text-neutral-300">{liveness.initialDelaySeconds}s</span></div>
                <div>Timeout: <span className="text-neutral-300">{liveness.timeoutSeconds}s</span></div>
                <div>Failure Threshold: <span className="text-neutral-300">{liveness.failureThreshold} attempts</span></div>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-neutral-500 italic">No liveness check configured</p>
          )}
        </div>

        {/* Readiness Probe Column */}
        <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
              Readiness Probe
            </span>
            {readiness ? (
              <span className={`h-1.5 w-1.5 rounded-full ${isReady ? "bg-emerald-400" : "bg-amber-400"}`} />
            ) : (
              <span className="text-[9px] text-neutral-600">None</span>
            )}
          </div>

          {readiness ? (
            <div className="space-y-1.5 text-[11px]">
              <div className="text-neutral-200 font-semibold truncate text-emerald-300">
                {readiness.type.toUpperCase()}{" "}
                {readiness.path ? `${readiness.path}` : ""}{" "}
                {readiness.port ? `:${readiness.port}` : ""}
              </div>
              <div className="text-[10px] text-neutral-400 space-y-0.5">
                <div>Interval: <span className="text-neutral-300">every {readiness.periodSeconds}s</span></div>
                <div>Initial Delay: <span className="text-neutral-300">{readiness.initialDelaySeconds}s</span></div>
                <div>Timeout: <span className="text-neutral-300">{readiness.timeoutSeconds}s</span></div>
                <div>Failure Threshold: <span className="text-neutral-300">{readiness.failureThreshold} attempts</span></div>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-neutral-500 italic">No readiness check configured</p>
          )}
        </div>
      </div>
    </div>
  );
}
