import { MdFlashOn as HpaIcon } from "react-icons/md";
import type { K8sHPAData } from "../../../store/types/topologyTypes";

interface AutoscalingHPASectionProps {
  hpa: K8sHPAData | null;
}

export function AutoscalingHPASection({ hpa }: AutoscalingHPASectionProps) {
  if (!hpa) return null;

  const currentCPU = hpa.currentCpuUtil ?? 0;
  const targetCPU = hpa.targetCpuUtil ?? 50;

  const cpuBarColor =
    currentCPU > 80
      ? "bg-rose-500 shadow-sm shadow-rose-500/50"
      : currentCPU >= targetCPU
      ? "bg-amber-400 shadow-sm shadow-amber-500/30"
      : "bg-cyan-500 shadow-sm shadow-cyan-500/30";

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-neutral-900/50 p-3.5 space-y-3 font-mono">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5 font-sans">
          <HpaIcon className="h-4 w-4 text-cyan-400" />
          Autoscaling (HPA) Telemetry
        </h4>
        <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
          {hpa.name}
        </span>
      </div>

      {/* Visual Gauge Bar: Current CPU vs Target Marker */}
      <div className="space-y-1.5 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
        <div className="flex justify-between text-xs">
          <span className="text-neutral-400 flex items-center gap-1">
            Current CPU:
            <span className={`font-bold ${currentCPU > 80 ? "text-rose-400" : currentCPU >= targetCPU ? "text-amber-400" : "text-cyan-300"}`}>
              {currentCPU}%
            </span>
          </span>
          <span className="text-neutral-400 flex items-center gap-1 text-[11px]">
            Target:
            <span className="text-amber-400 font-semibold">{targetCPU}%</span>
          </span>
        </div>

        {/* Gauge Track */}
        <div className="relative h-3 w-full rounded-full bg-neutral-800/80 overflow-hidden border border-neutral-700/60">
          {/* Progress Bar */}
          <div
            className={`h-full transition-all duration-500 rounded-full ${cpuBarColor}`}
            style={{ width: `${Math.min(currentCPU, 100)}%` }}
          />
          {/* Vertical Target Marker Line */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.9)] z-10"
            style={{ left: `${Math.min(targetCPU, 99)}%` }}
            title={`Target Threshold: ${targetCPU}%`}
          />
        </div>

        <div className="flex justify-between text-[10px] text-neutral-500 pt-0.5">
          <span>0%</span>
          <span className="text-amber-400/90 font-semibold">▲ Target {targetCPU}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Min</span>
          <span className="font-bold text-neutral-200">{hpa.minReplicas}</span>
        </div>
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Max</span>
          <span className="font-bold text-neutral-200">{hpa.maxReplicas}</span>
        </div>
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Current</span>
          <span className="font-bold text-cyan-300">{hpa.currentReplicas}</span>
        </div>
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Desired</span>
          <span className="font-bold text-emerald-400">{hpa.desiredReplicas}</span>
        </div>
      </div>
    </div>
  );
}
