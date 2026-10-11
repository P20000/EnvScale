import { Handle, Position } from "@xyflow/react";
import { useUIStore } from "../../store/useUIStore";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { RolloutInfo } from "../../store/helpers/rolloutHelpers";
import type { K8sPodData } from "./K8sPod";
import { MdLayers as DeploymentIcon, MdStorage as StatefulSetIcon, MdSync as SyncIcon } from "react-icons/md";

export interface PodSummary {
  name: string;
  phase: string;
  isReady: boolean;
  isTerminating: boolean;
  restarts: number;
  podData: K8sPodData;
}

export interface K8sGroupData extends Record<string, unknown> {
  name: string;
  namespace?: string;
  workloadType?: "Deployment" | "StatefulSet" | "ReplicaSet" | "DaemonSet";
  replicas?: number;
  readyReplicas?: number;
  pods?: K8sPodData[];
  podSummaries?: PodSummary[];
  rolloutInfo?: RolloutInfo | null;
}

export function K8sGroupNode({ data }: { data: K8sGroupData }) {
  const layoutDirection = useUIStore((s) => s.layoutDirection);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const isTB = layoutDirection === "TB";

  const rollout = data.rolloutInfo;
  const isRolling = Boolean(rollout?.isRollingUpdate);
  const isStandalone = Boolean(rollout?.isStandaloneReplicaSet);

  const rawPods = (data.pods || []) as K8sPodData[];
  const summaries: PodSummary[] = (data.podSummaries as PodSummary[]) || rawPods.map((p) => {
    const ph = String(p.phase || p.status || "Running").toLowerCase();
    const isTerminating = Boolean(p.isTerminating || ph === "terminating");
    const isReady = !isTerminating && (ph === "running" || ph === "ready");
    return {
      name: p.name,
      phase: p.phase || p.status || "Running",
      isReady,
      isTerminating,
      restarts: Number(p.restarts || p.restartCount || 0),
      podData: p,
    };
  });

  const totalReplicas = data.replicas ?? (summaries.length > 0 ? summaries.length : 1);
  const readyReplicas = data.readyReplicas ?? summaries.filter((s) => s.isReady).length;
  const hasErrors = summaries.some((s) => {
    const ph = s.phase.toLowerCase();
    return ph.includes("crash") || ph.includes("oom") || ph.includes("error") || ph.includes("fail");
  });

  const isHealthy = readyReplicas === totalReplicas && totalReplicas > 0 && !hasErrors;
  const isScaling = readyReplicas !== totalReplicas && !hasErrors;

  const isStatefulSet = data.workloadType === "StatefulSet" || data.name.toLowerCase().includes("db") || data.name.toLowerCase().includes("redis");

  const handleCardClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (summaries.length > 0 && summaries[0].podData) {
      setSelectedNode({ type: "pod", data: summaries[0].podData });
    }
  };

  const handlePodGlyphClick = (e: React.MouseEvent, pod: K8sPodData) => {
    e.stopPropagation();
    setSelectedNode({ type: "pod", data: pod });
  };

  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex flex-col justify-between w-[270px] min-h-[76px] rounded-xl p-3 border transition-all duration-200 cursor-pointer select-none shadow-lg backdrop-blur-md ${
        isRolling
          ? "bg-amber-950/20 border-amber-500/60 shadow-amber-950/20 hover:border-amber-400"
          : isStandalone
          ? "bg-purple-950/20 border-purple-500/50 hover:border-purple-400"
          : hasErrors
          ? "bg-rose-950/20 border-rose-500/60 shadow-rose-950/20 hover:border-rose-400"
          : "bg-zinc-950/90 border-zinc-800/90 shadow-black/40 hover:border-zinc-700 hover:bg-zinc-900/90"
      }`}
    >
      <Handle
        type="target"
        position={isTB ? Position.Top : Position.Left}
        id="left-target"
        isConnectable={false}
        className="!opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !border-0 !bg-transparent pointer-events-none"
      />
      <Handle
        type="target"
        position={isTB ? Position.Bottom : Position.Right}
        id="bottom-target"
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

      {/* Top Header: Kind Icon, Workload Name, Status Badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`p-1 rounded-md shrink-0 border ${
            isStatefulSet
              ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
              : "bg-blue-500/10 border-blue-500/20 text-blue-400"
          }`}>
            {isStatefulSet ? <StatefulSetIcon className="text-xs" /> : <DeploymentIcon className="text-xs" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[11px] font-mono font-bold text-zinc-100 truncate tracking-tight uppercase">
              {data.name}
            </span>
            <span className="text-[9px] font-mono text-zinc-500 truncate">
              {isStatefulSet ? "StatefulSet" : "Deployment"} • {data.namespace || "default"}
            </span>
          </div>
        </div>

        {/* Replica Status Badge */}
        {isRolling ? (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 flex items-center gap-1 shrink-0">
            <SyncIcon className="animate-spin text-[10px]" />
            Rolling
          </span>
        ) : (
          <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border shrink-0 flex items-center gap-1 ${
            isHealthy
              ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
              : hasErrors
              ? "text-rose-400 bg-rose-500/10 border-rose-500/30"
              : isScaling
              ? "text-amber-400 bg-amber-500/10 border-amber-500/30 animate-pulse"
              : "text-zinc-400 bg-zinc-800 border-zinc-700"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              isHealthy ? "bg-emerald-400" : hasErrors ? "bg-rose-400" : "bg-amber-400 animate-ping"
            }`} />
            {readyReplicas}/{totalReplicas} Ready
          </span>
        )}
      </div>

      {/* Bottom: Micro-Honeycomb / Heatmap Pod Replica Matrix */}
      <div className="flex items-center gap-1 pt-2 border-t border-zinc-800/60 flex-wrap max-h-[30px] overflow-hidden">
        {summaries.length > 0 ? (
          summaries.slice(0, 36).map((pod, idx) => {
            const ph = pod.phase.toLowerCase();
            const isErr = ph.includes("crash") || ph.includes("oom") || ph.includes("error") || ph.includes("fail");
            const isPending = pod.isTerminating || ph.includes("pending") || (!pod.isReady && !isErr);

            const colorClass = isErr
              ? "bg-rose-500 border-rose-400/80 shadow-xs shadow-rose-500/50 animate-pulse"
              : isPending
              ? "bg-amber-400 border-amber-300/80 animate-pulse"
              : "bg-emerald-400 border-emerald-300/80 shadow-xs shadow-emerald-500/30";

            return (
              <button
                key={pod.name || idx}
                onClick={(e) => handlePodGlyphClick(e, pod.podData)}
                title={`${pod.name} (${pod.phase}${pod.restarts > 0 ? `, ${pod.restarts} restarts` : ""})`}
                className={`h-2.5 w-2.5 rounded-xs border transition-transform duration-150 hover:scale-135 hover:z-20 cursor-pointer ${colorClass}`}
              />
            );
          })
        ) : (
          <span className="text-[8.5px] font-mono text-zinc-600 italic">No pods currently scheduled</span>
        )}

        {summaries.length > 36 && (
          <span className="text-[8.5px] font-mono text-zinc-500 pl-1">
            +{summaries.length - 36} more
          </span>
        )}
      </div>
    </div>
  );
}

K8sGroupNode.displayName = "K8sGroupNode";
