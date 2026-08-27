import { MdShield as ShieldIcon, MdSettings as GearIcon } from "react-icons/md";
import type { K8sDaemonSetData } from "../../store/types/topologyTypes";

export function K8sDaemonSetNode({ data }: { data: K8sDaemonSetData }) {
  const ready = data.numberReady || 0;
  const desired = data.desiredNumberScheduled || 0;
  const isHealthy = ready === desired && desired > 0;

  return (
    <div className="h-11 w-[270px] border border-indigo-500/50 bg-[#121220] flex items-center justify-between px-3 rounded-md select-none group hover:border-indigo-400 transition-all shadow-[0_0_12px_rgba(99,102,241,0.15)] relative">
      {/* 
        Clean Handle-less Card Design:
        DaemonSets are unlinked side-rail cluster agents. Handles are intentionally omitted 
        to prevent accidental edge attachments during user interaction or auto-layout.
      */}
      <div className="flex items-center gap-2 min-w-0">
        <ShieldIcon size={16} className="text-indigo-400 shrink-0" />
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono font-bold truncate text-indigo-100 max-w-[110px]">
              {data.name}
            </span>
          </div>
          <span className="text-[8.5px] font-mono text-indigo-300/90 uppercase tracking-wider -mt-0.5 flex items-center gap-1">
            <GearIcon size={9} className="text-indigo-400" />
            DaemonSet • Host Agent
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${
            isHealthy
              ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
              : "text-amber-300 border-amber-500/30 bg-amber-500/10"
          }`}
        >
          {ready}/{desired} Nodes
        </span>
      </div>
    </div>
  );
}
