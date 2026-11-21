import React from "react";
import { MdStorage as StorageIcon } from "react-icons/md";
import type { K8sPodData } from "../K8sPod";
import type { VolumeClaimTemplateInfo } from "../../../store/types/topologyTypes";
import { useTopologyStore } from "../../../store/useTopologyStore";

export interface StatefulOrdinalBladeProps {
  ordinal: number;
  pod?: K8sPodData;
  vct?: VolumeClaimTemplateInfo;
  isDesired: boolean;
  onSelectPod?: (pod: K8sPodData) => void;
}

export const StatefulOrdinalBlade: React.FC<StatefulOrdinalBladeProps> = ({
  ordinal,
  pod,
  vct,
  isDesired,
  onSelectPod,
}) => {
  const activeChaosFaults = useTopologyStore((s) => s.activeChaosFaults);
  const pvcs = useTopologyStore((s) => s.pvcs);

  const podName = pod?.name || `instance-${ordinal}`;
  const podFault = pod?.name ? activeChaosFaults?.[pod.name] : undefined;
  const isChaos = Boolean(podFault);

  const phase = String(pod?.phase || pod?.status || (isDesired ? "Pending" : "Decommissioned")).toLowerCase();
  const isRunning = phase === "running" || phase === "ready";
  const isTerminating = Boolean(pod?.isTerminating || phase === "terminating");
  const isError = phase.includes("crash") || phase.includes("oom") || phase.includes("fail") || phase.includes("error");
  const isPending = !isTerminating && !isError && !isRunning;

  const statusColorClass = isChaos
    ? "text-rose-400 bg-rose-500/10 border-rose-500/30"
    : isError
    ? "text-rose-400 bg-rose-500/10 border-rose-500/30"
    : isTerminating
    ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
    : isPending
    ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
    : isRunning
    ? "text-[#6DD6A8] bg-[#6DD6A8]/10 border-[#6DD6A8]/20"
    : "text-zinc-500 bg-zinc-800/40 border-zinc-700/30";

  const statusLabel = isChaos
    ? `CHAOS: ${podFault?.faultType.toUpperCase()}`
    : isTerminating
    ? "Terminating"
    : isError
    ? "CrashLoop"
    : isRunning
    ? "Running"
    : isPending
    ? "Pending"
    : "Offline";

  const podIp = pod?.podIp || pod?.ip || (isRunning ? `10.244.${ordinal + 1}.${10 + ordinal}` : "Unassigned");
  const nodeName = pod?.nodeName || (isRunning ? `worker-${(ordinal % 2) + 1}` : "unassigned");

  // Matched 1:1 PVC from volumeClaimTemplates
  const vctName = vct?.name || "data";
  const expectedPvcName = `${vctName}-${podName}`;
  const matchedPvc = pvcs.find((p) => p.name === expectedPvcName || (p.name.includes(vctName) && p.name.includes(`-${ordinal}`)));
  const pvcStorage = matchedPvc?.storage || vct?.storage || "10 Gi";
  const pvcPhase = matchedPvc?.phase || (isRunning ? "Bound" : "Pending");
  const isPvcBound = pvcPhase.toLowerCase() === "bound";

  return (
    <div
      onClick={(e) => {
        if (pod && onSelectPod) {
          e.stopPropagation();
          onSelectPod(pod);
        }
      }}
      title={`Pod: ${podName}\nIP: ${podIp}\nNode: ${nodeName}\nStorage Claim: ${expectedPvcName} (${pvcStorage}, ${vct?.accessModes || "RWO"}) • Status: ${pvcPhase}`}
      className={`flex-1 min-w-[110px] max-w-[135px] h-full box-border bg-[#14161A] border rounded-md transition-all duration-150 select-none group cursor-pointer p-2 flex flex-col justify-between gap-1.5 ${
        isChaos
          ? "border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.2)]"
          : "border-[#2D3139] hover:border-[#4B515D] hover:bg-[#181B21]"
      }`}
    >
      {/* Ordinal Identity & Health Indicator */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-[9px] font-bold px-1 py-0.2 rounded bg-purple-500/15 text-purple-300">
            #{ordinal}
          </span>
          <span className="font-mono text-[10px] font-semibold text-[#E6E1E5] truncate" title={podName}>
            {podName}
          </span>
        </div>
        <div
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
            isRunning ? "bg-[#6DD6A8] shadow-[0_0_4px_#6DD6A8]" : isError ? "bg-rose-500 animate-pulse" : "bg-amber-400"
          }`}
        />
      </div>

      {/* Pod Execution Status Badge */}
      <div className="flex items-center justify-between">
        <span className={`text-[8px] font-mono px-1 py-0.2 rounded border font-semibold truncate ${statusColorClass}`}>
          {statusLabel}
        </span>
      </div>

      {/* Compact Attached Storage Indicator (Replaces separate storage card) */}
      <div
        className="flex items-center justify-between px-1.5 py-0.5 bg-[#0F1115] rounded border border-[#23262D] text-[8px] font-mono group-hover:border-[#383D47] transition-colors"
        title={`Storage: ${expectedPvcName} • Status: ${pvcPhase}`}
      >
        <div className="flex items-center gap-1 min-w-0">
          <StorageIcon className="text-cyan-400 text-[10px] shrink-0" />
          <span className="text-zinc-400 truncate max-w-[55px]">{vctName}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0" title={`PVC ${pvcPhase}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              isPvcBound ? "bg-cyan-400 shadow-[0_0_4px_#22d3ee]" : "bg-amber-400"
            }`}
          />
          <span className={`text-[7.5px] ${isPvcBound ? "text-cyan-400" : "text-amber-400"}`}>
            {isPvcBound ? "Bound" : "Pend"}
          </span>
        </div>
      </div>
    </div>
  );
};
