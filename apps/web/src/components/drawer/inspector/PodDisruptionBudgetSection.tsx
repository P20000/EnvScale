import { LifeBuoy, AlertCircle, CheckCircle2 } from "lucide-react";
import type { K8sPDBData } from "../../../store/types/topologyTypes";

interface PodDisruptionBudgetSectionProps {
  pdb: K8sPDBData | null;
}

export function PodDisruptionBudgetSection({ pdb }: PodDisruptionBudgetSectionProps) {
  if (!pdb) return null;

  const isExhausted = pdb.disruptionsAllowed <= 0;
  const targetConstraint = pdb.minAvailable
    ? `Min Available: ${pdb.minAvailable}`
    : pdb.maxUnavailable
    ? `Max Unavailable: ${pdb.maxUnavailable}`
    : "Disruption Guard Active";

  const healthyPct = pdb.desiredHealthy > 0
    ? Math.min(100, Math.round((pdb.currentHealthy / pdb.desiredHealthy) * 100))
    : pdb.currentHealthy > 0
    ? 100
    : 0;

  return (
    <div className={`rounded-xl border p-3.5 space-y-3 font-mono ${
      isExhausted
        ? "border-rose-500/30 bg-rose-950/20"
        : "border-teal-500/30 bg-neutral-900/50"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5 font-sans">
          <LifeBuoy className={`h-4 w-4 ${isExhausted ? "text-rose-400 animate-spin" : "text-teal-400"}`} />
          Disruption Budget (PDB)
        </h4>
        <span
          className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 ${
            isExhausted
              ? "bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse font-bold"
              : "bg-teal-500/10 border-teal-500/30 text-teal-300 font-semibold"
          }`}
        >
          {isExhausted ? (
            <>
              <AlertCircle className="w-3 h-3 text-rose-400" />
              0 Allowed (Exhausted)
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3 h-3 text-teal-400" />
              {pdb.disruptionsAllowed} Allowed
            </>
          )}
        </span>
      </div>

      {/* Target Constraint Banner */}
      <div className="flex items-center justify-between bg-neutral-950 p-2 rounded-lg border border-neutral-800 text-xs">
        <span className="text-neutral-400 text-[11px]">Constraint Rule:</span>
        <span className="text-teal-300 font-bold">{targetConstraint}</span>
      </div>

      {/* Healthy Pod Availability Bar */}
      <div className="space-y-1.5 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
        <div className="flex justify-between text-xs">
          <span className="text-neutral-400 flex items-center gap-1">
            Healthy Pods:
            <span className={`font-bold ${isExhausted ? "text-rose-400" : "text-teal-300"}`}>
              {pdb.currentHealthy} / {pdb.desiredHealthy || pdb.expectedPods}
            </span>
          </span>
          <span className="text-neutral-400 text-[11px] font-semibold">
            {healthyPct}% SLA
          </span>
        </div>

        <div className="relative h-2.5 w-full rounded-full bg-neutral-800/80 overflow-hidden border border-neutral-700/60">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              isExhausted
                ? "bg-rose-500 shadow-sm shadow-rose-500/50"
                : "bg-gradient-to-r from-teal-500 to-emerald-400 shadow-sm shadow-teal-500/30"
            }`}
            style={{ width: `${healthyPct}%` }}
          />
        </div>
      </div>

      {/* Telemetry Stats Grid */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Expected</span>
          <span className="font-bold text-neutral-200">{pdb.expectedPods}</span>
        </div>
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Healthy</span>
          <span className={`font-bold ${pdb.currentHealthy < pdb.desiredHealthy ? "text-amber-400" : "text-neutral-200"}`}>
            {pdb.currentHealthy}
          </span>
        </div>
        <div className="p-2 rounded bg-neutral-950 border border-neutral-800">
          <span className="block text-[10px] text-neutral-400">Desired</span>
          <span className="font-bold text-neutral-200">{pdb.desiredHealthy}</span>
        </div>
        <div className={`p-2 rounded bg-neutral-950 border ${isExhausted ? "border-rose-500/50 bg-rose-950/20" : "border-neutral-800"}`}>
          <span className="block text-[10px] text-neutral-400">Allowed</span>
          <span className={`font-bold ${isExhausted ? "text-rose-400 font-extrabold" : "text-teal-300"}`}>
            {pdb.disruptionsAllowed}
          </span>
        </div>
      </div>

      {/* Target Selector Tags */}
      {pdb.matchLabels && Object.keys(pdb.matchLabels).length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="text-[10px] text-neutral-500">Selector:</span>
          {Object.entries(pdb.matchLabels).map(([k, v]) => (
            <span
              key={k}
              className="text-[9.5px] px-1.5 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300"
            >
              {k}={v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
