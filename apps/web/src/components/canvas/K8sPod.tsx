import { Handle, Position } from "@xyflow/react";
import { MdViewInAr as Icon } from "react-icons/md";
import { useUIStore } from "../../store/useUIStore";
import { useTopologyStore } from "../../store/useTopologyStore";
import { getActivePodFault } from "../../store/helpers/chaosHelpers";
import type { PodVolumeInfo, PodConfigReference, PodSecretReference } from "../../store/types/topologyTypes";

export interface K8sPodData extends Record<string, unknown> {
  name: string;
  namespace: string;
  nodeName?: string;
  status: "Running" | "CrashLoopBackOff" | "Pending" | "ContainerCreating" | "Terminating" | "Terminated" | "Failed" | "Unknown" | "Succeeded" | "Completed" | "OOMKilled";
  isTerminating?: boolean;
  restarts: number;
  ip?: string;
  podIp?: string;
  createdAt?: string;
  cpuUsage?: string;
  memoryUsage?: string;
  cpuUsageMcores?: number;
  memoryUsageMiB?: number;
  ownerName?: string;
  ownerKind?: string;
  ownerUid?: string;
  labels?: Record<string, string>;
  isStaticPod?: boolean;
  isControlPlane?: boolean;
  containers?: unknown[];
  containerStatuses?: unknown[];
  volumes?: PodVolumeInfo[];
  configMaps?: PodConfigReference[];
  secrets?: PodSecretReference[];
}

export function K8sPodNode({ data }: { data: K8sPodData }) {
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const rawRes = (data.rawResource as Record<string, unknown>) || {};
  const rawStatus = (rawRes.status as Record<string, unknown>) || {};
  const containerStatuses = (rawStatus.containerStatuses || data.containerStatuses || []) as Array<Record<string, unknown>>;

  const waiting = containerStatuses.find((c) => (c.state as Record<string, unknown>)?.waiting)?.state as Record<string, unknown> | undefined;
  const terminated = containerStatuses.find((c) => (c.state as Record<string, unknown>)?.terminated)?.state as Record<string, unknown> | undefined;

  const waitingReason = String((waiting?.waiting as Record<string, unknown>)?.reason || waiting?.reason || "");
  const terminatedReason = String((terminated?.terminated as Record<string, unknown>)?.reason || terminated?.reason || "");
  const rawPhase = String(data.phase || data.status || "").trim();

  const activeChaosFaults = useTopologyStore((s) => s.activeChaosFaults);
  const podFault = getActivePodFault(activeChaosFaults, data.name);
  const isChaosActive = Boolean(podFault);

  const isTerminating = Boolean(
    data.isTerminating ||
    rawPhase === "Terminating" ||
    rawPhase === "Terminated" ||
    (rawRes.metadata as Record<string, unknown>)?.deletionTimestamp
  );

  let dotClass = "bg-zinc-700";
  let textClass = "text-zinc-500";
  let badgeLabel = "";

  if (isChaosActive) {
    dotClass = "bg-rose-500 animate-ping";
    textClass = "text-rose-300 font-bold";
    badgeLabel = `⚡ ${podFault?.faultType.toUpperCase() || "CHAOS"}`;
  } else if (isTerminating) {
    dotClass = "bg-zinc-600 animate-pulse";
    textClass = "text-zinc-500";
    badgeLabel = "DRAINING";
  } else if (
    terminatedReason === "OOMKilled" ||
    waitingReason === "CrashLoopBackOff" ||
    waitingReason === "OOMKilled" ||
    rawPhase === "OOMKilled" ||
    rawPhase === "CrashLoopBackOff"
  ) {
    dotClass = "bg-rose-500 animate-pulse";
    textClass = "text-rose-300 font-bold";
    badgeLabel = terminatedReason === "OOMKilled" || waitingReason === "OOMKilled" ? "OOM" : "CRASH";
  } else if (rawPhase === "Running" || rawPhase === "Ready") {
    dotClass = "bg-emerald-500";
    textClass = "text-zinc-200";
  } else if (rawPhase === "Succeeded" || rawPhase === "Completed") {
    dotClass = "bg-zinc-500";
    textClass = "text-zinc-400";
  } else if (rawPhase === "Pending" || rawPhase === "ContainerCreating") {
    dotClass = "bg-amber-400";
    textClass = "text-amber-200/90";
  } else if (rawPhase === "Failed" || rawPhase === "Error") {
    dotClass = "bg-rose-500";
    textClass = "text-rose-300";
  }

  const restarts = Number(data.restarts ?? 0);

  const containerClass = isChaosActive
    ? "h-8 w-[208px] bg-rose-950/40 border border-rose-500/80 rounded-md px-2 flex items-center justify-between shadow-lg shadow-rose-950/60 ring-1 ring-rose-500/50 select-none group relative transition-all duration-300 animate-pulse"
    : isTerminating
    ? "h-8 w-[208px] bg-[#09090b]/60 border border-dashed border-zinc-700/60 rounded-md px-2 flex items-center justify-between opacity-40 grayscale select-none group relative transition-all duration-300"
    : "h-8 w-[208px] bg-[#09090b] border border-zinc-800/80 rounded-md px-2 flex items-center justify-between transition-colors hover:border-zinc-600 select-none group relative";

  return (
    <div
      className={containerClass}
      title={isTerminating ? `${data.name} (Terminating / Draining)` : data.name}
    >
      {/* 4-Cardinal Dynamic Handles */}
      <Handle type="target" position={Position.Left} id="target-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Right} id="target-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Top} id="target-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      <Handle type="source" position={Position.Left} id="source-left" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Right} id="source-right" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Top} id="source-top" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" isConnectable={false} className="!opacity-0 !w-0 !h-0 pointer-events-none" />

      {/* Legacy Fallback Handles */}
      <Handle
        type="target"
        position={isTB ? Position.Top : Position.Left}
        id="left-target"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />
      <Handle
        type="source"
        position={isTB ? Position.Bottom : Position.Right}
        id="right-source"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />

      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className={`${isTerminating ? "text-zinc-600" : "text-zinc-400"} text-sm shrink-0`} />
        <span className={`text-[11px] font-mono font-semibold truncate max-w-[95px] ${textClass}`}>
          {data.name}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {(data.isControlPlane || data.isStaticPod) && !isTerminating && (
          <span className="text-[8.5px] font-mono font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-1 rounded uppercase tracking-wider" title="Control Plane / Static Pod (Kubelet Managed)">
            CP
          </span>
        )}
        {data.volumes && data.volumes.length > 0 && !isTerminating && (
          <span className="text-[8.5px] font-mono font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-1 rounded uppercase tracking-wider" title={`Mounted Storage: ${data.volumes.map(v => v.pvcName || v.name).join(', ')}`}>
            PVC
          </span>
        )}
        {restarts > 0 && !isTerminating && (
          <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1 rounded" title={`${restarts} Restarts`}>
            ↺ {restarts}
          </span>
        )}
        {badgeLabel && badgeLabel === "DRAINING" && (
          <span className="text-[8.5px] font-mono font-bold text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-1 rounded uppercase tracking-wider">
            DRAINING
          </span>
        )}
        {badgeLabel && badgeLabel !== "DRAINING" && (
          <span className="text-[8.5px] font-mono font-black text-rose-300 bg-rose-500/20 border border-rose-500/30 px-1 rounded uppercase tracking-wider">
            {badgeLabel}
          </span>
        )}
        <div className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
      </div>
    </div>
  );
}

K8sPodNode.displayName = "K8sPodNode";
