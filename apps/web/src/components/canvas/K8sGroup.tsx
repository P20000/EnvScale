import { Handle, Position } from "@xyflow/react";
import { useUIStore } from "../../store/useUIStore";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { RolloutInfo } from "../../store/helpers/rolloutHelpers";
import type { K8sPodData } from "./K8sPod";
import { getActiveWorkloadFault, getActivePodFault } from "../../store/helpers/chaosHelpers";
import {
  MdLayers as DeploymentIcon,
  MdStorage as StatefulSetIcon,
  MdSync as SyncIcon,
  MdDescription as ConfigIcon,
  MdLockOutline as SecretIcon,
  MdFlashOn as ChaosIcon,
} from "react-icons/md";

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
  const activeChaosFaults = useTopologyStore((s) => s.activeChaosFaults);
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

  const workloadFault = getActiveWorkloadFault(activeChaosFaults, data.name, summaries.map((s) => s.name));
  const isChaosActive = Boolean(workloadFault);

  const distinctConfigNames = Array.from(
    new Set(rawPods.flatMap((p) => p.configMaps?.map((c) => c.name) || []))
  ).filter(Boolean);

  const distinctSecretNames = Array.from(
    new Set(rawPods.flatMap((p) => p.secrets?.map((s) => s.name) || []))
  ).filter(Boolean);

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
      setSelectedNode({
        type: "pod",
        data: {
          ...summaries[0].podData,
          ownerName: data.name,
        },
      });
    }
  };

  const handlePodGlyphClick = (e: React.MouseEvent, pod: K8sPodData) => {
    e.stopPropagation();
    setSelectedNode({
      type: "pod",
      data: {
        ...pod,
        ownerName: data.name,
      },
    });
  };

  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex flex-col justify-between w-[270px] min-h-[76px] rounded-xl p-3 border transition-all duration-200 cursor-pointer select-none shadow-lg backdrop-blur-md ${
        isChaosActive
          ? "bg-rose-950/30 border-rose-500 shadow-xl shadow-rose-950/60 ring-1 ring-rose-500/50 hover:border-rose-400"
          : isRolling
          ? "bg-amber-950/20 border-amber-500/60 shadow-amber-950/20 hover:border-amber-400"
          : isStandalone
          ? "bg-purple-950/20 border-purple-500/50 hover:border-purple-400"
          : hasErrors
          ? "bg-rose-950/20 border-rose-500/60 shadow-rose-950/20 hover:border-rose-400"
          : "bg-zinc-950/90 border-zinc-800/90 shadow-black/40 hover:border-zinc-700 hover:bg-zinc-900/90"
      }`}
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

        {/* Badges Cluster: Configs, Secrets, Replicas */}
        <div className="flex items-center gap-1 shrink-0">
          {distinctConfigNames.length > 0 && (
            <span
              className="text-[8.5px] font-mono px-1 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 flex items-center gap-0.5 shrink-0"
              title={`ConfigMaps (${distinctConfigNames.length}): ${distinctConfigNames.join(", ")}`}
            >
              <ConfigIcon className="text-[10px]" />
              {distinctConfigNames.length}
            </span>
          )}
          {distinctSecretNames.length > 0 && (
            <span
              className="text-[8.5px] font-mono px-1 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 flex items-center gap-0.5 shrink-0"
              title={`Secrets (${distinctSecretNames.length}): ${distinctSecretNames.join(", ")}`}
            >
              <SecretIcon className="text-[10px]" />
              {distinctSecretNames.length}
            </span>
          )}

          {isChaosActive ? (
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border border-rose-500/50 bg-rose-600/20 text-rose-300 flex items-center gap-1 shrink-0 animate-pulse">
              <ChaosIcon className="text-[11px] text-rose-400 animate-bounce" />
              CHAOS: {workloadFault?.faultType.toUpperCase()}
            </span>
          ) : isRolling ? (
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
      </div>

      {/* Bottom: Micro-Honeycomb / Heatmap Pod Replica Matrix */}
      <div className="flex items-center gap-1 pt-2 border-t border-zinc-800/60 flex-wrap max-h-[30px] overflow-hidden">
        {isChaosActive && workloadFault?.faultType === "scale-down" && summaries.length === 0 ? (
          <span className="text-[8.5px] font-mono text-rose-400 font-semibold flex items-center gap-1 animate-pulse">
            <ChaosIcon className="text-[10px]" />
            0/0 Replicas — Outage Injected via Scale Down
          </span>
        ) : summaries.length > 0 ? (
          summaries.slice(0, 36).map((pod, idx) => {
            const podFault = getActivePodFault(activeChaosFaults, pod.name) || (workloadFault?.target === "pod" && workloadFault?.name === pod.name ? workloadFault : undefined);
            const isChaosImpacted = Boolean(podFault);

            const ph = pod.phase.toLowerCase();
            const isErr = ph.includes("crash") || ph.includes("oom") || ph.includes("error") || ph.includes("fail");
            const isPending = pod.isTerminating || ph.includes("pending") || (!pod.isReady && !isErr);

            const colorClass = isChaosImpacted
              ? "bg-rose-600 border-rose-300/90 shadow-xs shadow-rose-500/80 animate-ping ring-2 ring-rose-400/80"
              : isErr
              ? "bg-rose-500 border-rose-400/80 shadow-xs shadow-rose-500/50 animate-pulse"
              : isPending
              ? "bg-amber-400 border-amber-300/80 animate-pulse"
              : "bg-emerald-400 border-emerald-300/80 shadow-xs shadow-emerald-500/30";

            const tooltip = isChaosImpacted
              ? `⚡ CHAOS FAULT ACTIVE (${podFault?.faultType || workloadFault?.faultType}): ${pod.name} (${pod.phase})`
              : `${pod.name} (${pod.phase}${pod.restarts > 0 ? `, ${pod.restarts} restarts` : ""})`;

            return (
              <button
                key={pod.name || idx}
                onClick={(e) => handlePodGlyphClick(e, pod.podData)}
                title={tooltip}
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
