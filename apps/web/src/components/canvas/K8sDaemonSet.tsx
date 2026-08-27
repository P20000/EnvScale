import { MdOutlineShield as ShieldIcon } from "react-icons/md";
import type { K8sDaemonSetData } from "../../store/types/topologyTypes";

export function K8sDaemonSetNode({ data }: { data: K8sDaemonSetData }) {
  const ready = data.numberReady || 0;
  const desired = data.desiredNumberScheduled || 0;
  const isHealthy = ready === desired && desired > 0;

  return (
    <div className="w-[260px] h-[58px] p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 shadow-sm flex flex-col justify-between cursor-pointer transition-colors select-none relative overflow-hidden">
      {/* Row 1: Primary Header (Icon + Name | Coverage Badge) */}
      <div className="flex items-center justify-between min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldIcon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-100 tracking-tight truncate max-w-[130px]">
            {data.name}
          </span>
        </div>

        <span
          className={`h-5 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 font-mono text-[10px] font-medium border ${
            isHealthy
              ? "bg-zinc-800/80 text-zinc-300 border-zinc-700/50"
              : "bg-amber-950/40 text-amber-300 border-amber-800/50"
          }`}
        >
          {ready}/{desired} Nodes
        </span>
      </div>

      {/* Row 2: Secondary Metadata (Sub-type | Role Context) */}
      <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
        <span className="text-zinc-400 uppercase tracking-wider font-mono text-[10px]">
          DAEMONSET
        </span>
        <span className="text-zinc-500 font-mono text-[10px]">
          HOST AGENT
        </span>
      </div>
    </div>
  );
}

K8sDaemonSetNode.displayName = "K8sDaemonSetNode";
