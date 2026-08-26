import { Handle, Position } from "@xyflow/react";
import { MdViewInAr as Icon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface K8sPodData extends Record<string, unknown> {
  name: string;
  namespace: string;
  nodeName?: string;
  status: "Running" | "CrashLoopBackOff" | "Pending" | "ContainerCreating" | "Terminating" | "Terminated" | "Failed" | "Unknown" | "Succeeded" | "Completed" | "OOMKilled";
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
  containers?: unknown[];
  containerStatuses?: unknown[];
}

export function K8sPodNode({ data }: { data: K8sPodData }) {
  const layoutDirection = useTopologyStore((s) => s.layoutDirection);
  const isTB = layoutDirection === "TB";

  const rawRes = (data.rawResource as Record<string, unknown>) || {};
  const rawStatus = (rawRes.status as Record<string, unknown>) || {};
  const containerStatuses = (rawStatus.containerStatuses || data.containerStatuses || []) as Array<Record<string, unknown>>;

  const waiting = containerStatuses.find((c) => (c.state as Record<string, unknown>)?.waiting)?.state as Record<string, unknown> | undefined;
  const terminated = containerStatuses.find((c) => (c.state as Record<string, unknown>)?.terminated)?.state as Record<string, unknown> | undefined;

  const waitingReason = String((waiting?.waiting as Record<string, unknown>)?.reason || waiting?.reason || "");
  const terminatedReason = String((terminated?.terminated as Record<string, unknown>)?.reason || terminated?.reason || "");
  const rawPhase = String(data.phase || data.status || "").trim();

  let dotClass = "bg-zinc-700";
  let textClass = "text-zinc-500";
  let badgeLabel = "";

  if (
    terminatedReason === "OOMKilled" ||
    waitingReason === "CrashLoopBackOff" ||
    waitingReason === "OOMKilled" ||
    rawPhase === "OOMKilled" ||
    rawPhase === "CrashLoopBackOff"
  ) {
    dotClass = "bg-rose-500 shadow-[0_0_10px_#f43f5e] animate-pulse";
    textClass = "text-rose-300 font-bold";
    badgeLabel = terminatedReason === "OOMKilled" || waitingReason === "OOMKilled" ? "OOM" : "CRASH";
  } else if (rawPhase === "Running" || rawPhase === "Ready") {
    dotClass = "bg-emerald-400 shadow-[0_0_12px_#10b981]";
    textClass = "text-zinc-200";
  } else if (rawPhase === "Succeeded" || rawPhase === "Completed") {
    dotClass = "bg-zinc-500";
    textClass = "text-zinc-400";
  } else if (rawPhase === "Pending" || rawPhase === "ContainerCreating") {
    dotClass = "bg-amber-400 animate-pulse";
    textClass = "text-amber-200/90";
  } else if (rawPhase === "Failed" || rawPhase === "Error") {
    dotClass = "bg-rose-500 shadow-[0_0_10px_#f43f5e]";
    textClass = "text-rose-300";
  }

  const restarts = Number(data.restarts ?? 0);

  return (
    <div className="h-8 w-[208px] bg-[#09090b] border border-zinc-800/80 rounded-md px-2 flex items-center justify-between transition-colors hover:border-zinc-600 select-none group relative">
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
        <Icon className="text-zinc-400 text-sm shrink-0" />
        <span className={`text-[11px] font-mono font-semibold truncate max-w-[95px] ${textClass}`}>
          {data.name}
        </span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {restarts > 0 && (
          <span className="text-[9px] font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1 rounded" title={`${restarts} Restarts`}>
            ↺ {restarts}
          </span>
        )}
        {badgeLabel && (
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
