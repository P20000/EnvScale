import { useState } from "react";
import {
  MdFlashOn as Zap,
  MdRefresh as RotateCcw,
  MdWarning as AlertTriangle,
  MdHealing as HealIcon,
} from "react-icons/md";
import { LifeBuoy, AlertCircle, CheckCircle2 } from "lucide-react";
import type { SelectedTarget } from "../InspectorDrawer";
import type { K8sPodData } from "../../canvas/K8sPod";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { findWorkloadPDB } from "../../../store/helpers/policyHpaHelpers";

interface ChaosTabProps {
  target: NonNullable<SelectedTarget>;
  chaosActionMsg: string | null;
  triggerChaos: (
    faultType: "crash" | "oom-pressure" | "scale-down",
    actionLabel: string,
    force?: boolean
  ) => Promise<void>;
  clearChaos?: (faultId: string) => Promise<void>;
}

export function ChaosTab({ target, chaosActionMsg, triggerChaos, clearChaos }: ChaosTabProps) {
  const [isForceEnabled, setIsForceEnabled] = useState(false);
  const activeChaosFaults = useTopologyStore((s) => s.activeChaosFaults) || {};
  const pdbs = useTopologyStore((s) => s.pdbs) || [];

  const podData = target.data as K8sPodData;
  const workloadName = podData.labels?.app || podData.ownerName || target.data.name;

  const matchedPDB = findWorkloadPDB(pdbs, workloadName, podData.namespace, podData.labels);
  const isBudgetExhausted = Boolean(matchedPDB && matchedPDB.disruptionsAllowed <= 0);

  const relevantFaults = Object.values(activeChaosFaults).filter(
    (f) => f.name === target.data.name || f.name === workloadName
  );

  return (
    <div className="space-y-4">
      {/* Header Info Banner */}
      <div className="rounded-xl border border-rose-900/40 bg-rose-950/20 p-3.5 space-y-2">
        <h4 className="text-xs font-semibold text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
          <Zap className="h-4 w-4 text-rose-400" />
          Chaos Fault Injection Engine
        </h4>
        <p className="text-[11px] text-neutral-400 leading-relaxed">
          Inject synthetic fault scenarios directly into workload{" "}
          <span className="font-mono text-neutral-200">{target.data.name}</span> to test streaming observability and cluster self-healing index.
        </p>
      </div>

      {/* PDB Safety Guardrail Status Card */}
      {matchedPDB && (
        <div className={`rounded-xl border p-3 space-y-2 text-xs font-mono ${
          isBudgetExhausted
            ? "border-rose-500/40 bg-rose-950/30 text-rose-300"
            : "border-teal-500/30 bg-teal-950/20 text-teal-300"
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5 text-[11px]">
              <LifeBuoy className={`h-3.5 w-3.5 ${isBudgetExhausted ? "text-rose-400 animate-spin" : "text-teal-400"}`} />
              PDB Guardrail ({matchedPDB.name})
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${
              isBudgetExhausted
                ? "bg-rose-500/20 border-rose-500/40 text-rose-300"
                : "bg-teal-500/20 border-teal-500/40 text-teal-300"
            }`}>
              {matchedPDB.disruptionsAllowed} Allowed
            </span>
          </div>

          <p className="text-[10.5px] leading-relaxed">
            {isBudgetExhausted ? (
              <span className="flex items-center gap-1 text-rose-300 font-sans">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                Disruption budget exhausted. Standard injection is blocked to prevent SLA downtime.
              </span>
            ) : (
              <span className="flex items-center gap-1 text-teal-200 font-sans">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-teal-400" />
                Workload has disruption headroom ({matchedPDB.disruptionsAllowed} available). Injection is safe.
              </span>
            )}
          </p>

          {/* Force Injection Toggle when Budget Exhausted */}
          {isBudgetExhausted && (
            <label className="flex items-center gap-2 pt-1 mt-1 border-t border-rose-500/20 cursor-pointer">
              <input
                type="checkbox"
                checked={isForceEnabled}
                onChange={(e) => setIsForceEnabled(e.target.checked)}
                className="rounded border-rose-500/50 bg-rose-950/60 text-rose-500 focus:ring-rose-500 h-3.5 w-3.5"
              />
              <span className="text-[11px] font-semibold text-rose-200">
                Force Fault Injection (Bypass PDB Safety Guardrail)
              </span>
            </label>
          )}
        </div>
      )}

      {/* Action / Error Banner */}
      {chaosActionMsg && (
        <div className={`rounded-lg border p-2.5 text-xs font-mono flex items-center gap-2 ${
          chaosActionMsg.includes("ERROR") || chaosActionMsg.includes("FAILED") || chaosActionMsg.includes("BLOCKED")
            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-300"
        }`}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="break-all">{chaosActionMsg}</span>
        </div>
      )}

      {/* Active Faults Live Monitor */}
      {relevantFaults.length > 0 && (
        <div className="space-y-2 rounded-xl border border-rose-600/50 bg-rose-950/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-rose-300 uppercase tracking-wider flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Active Faults Injected ({relevantFaults.length})
            </span>
          </div>

          <div className="space-y-2 mt-1">
            {relevantFaults.map((fault) => (
              <div
                key={fault.faultId}
                className="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-900/80 border border-rose-900/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      {fault.faultType}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-300 truncate">
                      {fault.name}
                    </span>
                    {fault.pdbBreached && (
                      <span className="px-1 py-0.2 rounded text-[9px] font-mono uppercase bg-red-600/30 text-red-200 border border-red-500/50">
                        PDB Breached
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                    Target: {fault.target} | {new Date(fault.timestamp).toLocaleTimeString()}
                  </p>
                </div>

                {clearChaos && (
                  <button
                    onClick={() => clearChaos(fault.faultId)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors cursor-pointer"
                  >
                    <HealIcon className="h-3.5 w-3.5" />
                    Revert
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fault Injection Actions */}
      <div className="space-y-2.5">
        <button
          onClick={() => triggerChaos("crash", "Pod Crash Loop (SIGKILL)", isForceEnabled)}
          className="w-full rounded-xl border border-rose-800/50 bg-neutral-900 p-3 text-left hover:bg-rose-950/30 hover:border-rose-700 transition-colors group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200 group-hover:text-rose-300">
              Simulate Pod Crash Loop
            </span>
            <RotateCcw className="h-3.5 w-3.5 text-neutral-500 group-hover:text-rose-400" />
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">
            Sends SIGKILL to target pod container to force automated K8s restart loop.
          </p>
        </button>

        <button
          onClick={() => triggerChaos("oom-pressure", "Memory Leak (OOMKilled)", isForceEnabled)}
          className="w-full rounded-xl border border-amber-800/50 bg-neutral-900 p-3 text-left hover:bg-amber-950/30 hover:border-amber-700 transition-colors group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200 group-hover:text-amber-300">
              Simulate High OOM Pressure
            </span>
            <AlertTriangle className="h-3.5 w-3.5 text-neutral-500 group-hover:text-amber-400" />
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">
            Allocates synthetic memory limit (1Mi) exceeding pod request to trigger OOMKilled state.
          </p>
        </button>

        <button
          onClick={() => triggerChaos("scale-down", "Replica Scale Down", isForceEnabled)}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:bg-neutral-800 transition-colors group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200 group-hover:text-cyan-300">
              Simulate Network Partition / Replica Scale Down
            </span>
            <Zap className="h-3.5 w-3.5 text-neutral-500 group-hover:text-cyan-400" />
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">
            Scales owning workload deployment replicas to 0 to simulate service outage.
          </p>
        </button>
      </div>
    </div>
  );
}
