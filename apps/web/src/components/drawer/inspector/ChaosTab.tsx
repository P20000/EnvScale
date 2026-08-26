import {
  MdFlashOn as Zap,
  MdRefresh as RotateCcw,
  MdWarning as AlertTriangle,
} from "react-icons/md";
import type { SelectedTarget } from "../InspectorDrawer";

interface ChaosTabProps {
  target: NonNullable<SelectedTarget>;
  chaosActionMsg: string | null;
  triggerChaos: (faultType: "crash" | "oom-pressure" | "scale-down", actionLabel: string) => Promise<void>;
}

export function ChaosTab({ target, chaosActionMsg, triggerChaos }: ChaosTabProps) {
  return (
    <div className="space-y-4">
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

      {chaosActionMsg && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs font-mono text-amber-300 animate-pulse flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          {chaosActionMsg}
        </div>
      )}

      <div className="space-y-2.5">
        <button
          onClick={() => triggerChaos("crash", "Pod Crash Loop (SIGKILL)")}
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
          onClick={() => triggerChaos("oom-pressure", "Memory Leak (OOMKilled)")}
          className="w-full rounded-xl border border-amber-800/50 bg-neutral-900 p-3 text-left hover:bg-amber-950/30 hover:border-amber-700 transition-colors group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200 group-hover:text-amber-300">
              Simulate High OOM Pressure
            </span>
            <AlertTriangle className="h-3.5 w-3.5 text-neutral-500 group-hover:text-amber-400" />
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">
            Allocates synthetic memory buffer exceeding pod limit to trigger OOMKilled state.
          </p>
        </button>

        <button
          onClick={() => triggerChaos("scale-down", "Replica Scale Down")}
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:bg-neutral-800 transition-colors group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-200 group-hover:text-cyan-300">
              Simulate Network Partition / Isolation
            </span>
            <Zap className="h-3.5 w-3.5 text-neutral-500 group-hover:text-cyan-400" />
          </div>
          <p className="text-[11px] text-neutral-500 mt-1">
            Blocks ingress HTTP traffic rules to test service routing fallback logic.
          </p>
        </button>
      </div>
    </div>
  );
}
