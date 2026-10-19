import { Handle, Position } from "@xyflow/react";
import { useUIStore } from "../../store/useUIStore";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { RolloutInfo } from "../../store/helpers/rolloutHelpers";
import type { K8sPodData } from "./K8sPod";
import { getActiveWorkloadFault, getActivePodFault } from "../../store/helpers/chaosHelpers";
import type { K8sHPAData, K8sNetworkPolicyData, K8sPDBData } from "../../store/types/topologyTypes";
import { LifeBuoy } from "lucide-react";
import {
  MdLayers as DeploymentIcon,
  MdStorage as StatefulSetIcon,
  MdSync as SyncIcon,
  MdDescription as ConfigIcon,
  MdLockOutline as SecretIcon,
  MdFlashOn as ChaosIcon,
  MdShield as ShieldIcon,
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
  hpa?: K8sHPAData | null;
  hasNetworkPolicy?: boolean;
  networkPolicies?: K8sNetworkPolicyData[];
  pdb?: K8sPDBData | null;
  hasProbeWarning?: boolean;
  cpuUsagePct?: number;
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
    const isFailing =
      ph.includes("crash") ||
      ph.includes("oom") ||
      ph.includes("error") ||
      ph.includes("fail") ||
      ph.includes("imagepull") ||
      ph.includes("createcontainer");
    const isReady = !isTerminating && !isFailing && (ph === "running" || ph === "ready") && p.ready !== false;
    return {
      name: p.name,
      phase: String(p.phase || p.status || "Running"),
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
    return (
      ph.includes("crash") ||
      ph.includes("oom") ||
      ph.includes("error") ||
      ph.includes("fail") ||
      ph.includes("imagepull") ||
      ph.includes("createcontainer")
    );
  });

  const isHealthy = readyReplicas === totalReplicas && totalReplicas > 0 && !hasErrors;
  const isScaling = readyReplicas !== totalReplicas && !hasErrors;

  const isStatefulSet = data.workloadType === "StatefulSet" || data.name.toLowerCase().includes("db") || data.name.toLowerCase().includes("redis");

  // If readyReplicas is 0 or all pods are dead/unready, CPU usage MUST strictly be 0%
  const isWorkloadDead = readyReplicas === 0 || (summaries.length > 0 && summaries.every((s) => !s.isReady));
  const cpuPct = isWorkloadDead ? 0 : (data.cpuUsagePct ?? (data.hpa?.currentCpuUtil ?? (isHealthy ? 2 : 0)));
  const cpuColorClass = isWorkloadDead
    ? "text-zinc-500 font-normal"
    : cpuPct > 80
    ? "text-rose-400 font-bold"
    : cpuPct >= 50
    ? "text-amber-400 font-medium"
    : "text-cyan-400/80";
  const cpuBarColor = isWorkloadDead
    ? "bg-transparent opacity-0"
    : cpuPct > 80
    ? "bg-gradient-to-r from-rose-600 via-rose-500 to-red-400 shadow-[0_0_10px_rgba(244,63,94,0.7)]"
    : cpuPct >= 50
    ? "bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
    : "bg-gradient-to-r from-cyan-600 via-cyan-400 to-teal-300 shadow-[0_0_8px_rgba(34,211,238,0.45)]";

  const hpa = data.hpa;
  const pdb = data.pdb;
  const hasNetPol = Boolean(data.hasNetworkPolicy || (data.networkPolicies && data.networkPolicies.length > 0));
  const netPolNames = (data.networkPolicies || []).map((n) => n.name).join(", ") || "Active Policy";

  const hasProbeWarning = Boolean(
    data.hasProbeWarning ||
    summaries.some((s) => (s.phase.toLowerCase() === "running" || s.phase.toLowerCase() === "ready") && !s.isReady)
  );

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
      className={`group relative flex flex-col justify-between w-[295px] min-h-[90px] rounded-xl p-2.5 border transition-all duration-200 cursor-pointer select-none ${
        isChaosActive
          ? "bg-[#191B20] border-[#30343B] hover:bg-[#23262D] hover:border-[#424750]"
          : isRolling
          ? "bg-[#191B20] border-[#30343B] hover:bg-[#23262D] hover:border-[#424750]"
          : isStandalone
          ? "bg-[#191B20] border-[#30343B] hover:bg-[#23262D] hover:border-[#424750]"
          : hasErrors
          ? "bg-[#191B20] border-[#30343B] hover:bg-[#23262D] hover:border-[#424750]"
          : "bg-[#191B20] border-[#30343B] hover:border-[#424750] hover:bg-[#23262D]"
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

      {/* Row 1: Identity & Core State */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`p-1 rounded-md shrink-0 border ${
            isStatefulSet
              ? "bg-[#D0BCFF]/10 border-[#D0BCFF]/20 text-[#D0BCFF]"
              : "bg-[#8ACBFA]/10 border-[#8ACBFA]/20 text-[#8ACBFA]"
          }`}>
            {isStatefulSet ? <StatefulSetIcon className="text-xs" /> : <DeploymentIcon className="text-xs" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span
              className="text-[11px] font-mono font-bold text-[#E6E1E5] truncate tracking-tight uppercase leading-none"
              title={data.name}
            >
              {data.name}
            </span>
            <span className="text-[9px] font-mono text-[#92959D] truncate leading-tight mt-0.5">
              {isStatefulSet ? "StatefulSet" : "Deployment"} • {data.namespace || "default"}
            </span>
          </div>
        </div>

        {/* Badges Cluster: Configs, Secrets, Replicas */}
        <div className="flex items-center gap-1 shrink-0">
          {distinctConfigNames.length > 0 && (
            <span
              className="text-[8.5px] font-mono px-1 py-0.5 rounded border border-[#F4C26B]/30 bg-[#F4C26B]/10 text-[#F4C26B] flex items-center gap-0.5 shrink-0"
              title={`ConfigMaps (${distinctConfigNames.length}): ${distinctConfigNames.join(", ")}`}
            >
              <ConfigIcon className="text-[10px]" />
              {distinctConfigNames.length}
            </span>
          )}
          {distinctSecretNames.length > 0 && (
            <span
              className="text-[8.5px] font-mono px-1 py-0.5 rounded border border-[#D0BCFF]/30 bg-[#D0BCFF]/10 text-[#D0BCFF] flex items-center gap-0.5 shrink-0"
              title={`Secrets (${distinctSecretNames.length}): ${distinctSecretNames.join(", ")}`}
            >
              <SecretIcon className="text-[10px]" />
              {distinctSecretNames.length}
            </span>
          )}

          {isChaosActive ? (
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-[#410E0B] text-[#F2B8B5] flex items-center gap-1 shrink-0">
              <ChaosIcon className="text-[11px] text-[#F2B8B5]" />
              CHAOS: {workloadFault?.faultType.toUpperCase()}
            </span>
          ) : isRolling ? (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-[#284568]/40 text-[#F4C26B] flex items-center gap-1 shrink-0">
              <SyncIcon className="animate-spin text-[10px]" />
              Rolling
            </span>
          ) : (
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md shrink-0 inline-flex items-center leading-none ${
              hasErrors
                ? "text-[#111318] bg-[#fc3f3f]"
                : isHealthy
                ? "text-[#111318] bg-[#6DD6A8]"
                : isScaling
                ? "text-[#111318] bg-[#F4C26B]"
                : "text-[#92959D] bg-[#23262D]"
            }`}>
              {readyReplicas}/{totalReplicas} Ready
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Chip Row (Policy, Governance & Telemetry Indicators) */}
      <div className="flex items-center justify-between pt-1.5 border-t border-[#30343B]/60 gap-1.5 font-mono text-[9px]">
        {/* Left: Policy & Protection Badges */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {/* Health Probe Warning: Rendered ONLY if a pod is failing probe checks */}
          {hasProbeWarning && (
            <span
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-300 text-[9px] shrink-0"
              title="Health Probe Warning: One or more pods failed liveness/readiness probe check"
            >
              <span className="text-[10px]">💓</span>
              <span className="text-[8px] font-bold">⚠️</span>
            </span>
          )}

          {/* HPA Indicator */}
          {hpa && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 transition-colors shrink-0"
              title={`HPA Active: ${hpa.currentReplicas}/${hpa.desiredReplicas} Replicas (CPU: ${hpa.currentCpuUtil ?? 0}% / ${hpa.targetCpuUtil ?? 50}% target)`}
            >
              <span className="text-[7.5px] font-extrabold uppercase px-1 py-[0.5px] rounded bg-cyan-500/25 text-cyan-300 tracking-wider">
                HPA
              </span>
              <span className="text-[9px] font-mono text-cyan-200/90 font-medium">
                {hpa.minReplicas}–{hpa.maxReplicas}
              </span>
            </span>
          )}

          {/* NetworkPolicy Shield */}
          {hasNetPol && (
            <span
              className="flex items-center justify-center p-0.5 rounded text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)] shrink-0"
              title={`NetworkPolicy Enforced: Strict Ingress (${netPolNames})`}
            >
              <ShieldIcon className="text-[13px]" />
            </span>
          )}

          {/* PodDisruptionBudget Lifebuoy Pill */}
          {pdb && (
            <span
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-all shrink-0 ${
                pdb.disruptionsAllowed > 0
                  ? "bg-teal-500/15 text-teal-300"
                  : "bg-rose-500/20 text-rose-300 animate-pulse"
              }`}
              title={
                pdb.disruptionsAllowed > 0
                  ? `PDB Protected (${pdb.name}): ${pdb.disruptionsAllowed} disruption(s) allowed [Min: ${pdb.minAvailable || "N/A"}, MaxUnavail: ${pdb.maxUnavailable || "N/A"}]`
                  : `PDB Exhausted (${pdb.name}): 0 disruptions allowed! Voluntary pod evictions blocked.`
              }
            >
              <LifeBuoy className={`w-3 h-3 ${pdb.disruptionsAllowed > 0 ? "text-teal-400" : "text-rose-400 animate-spin"}`} />
              <span className="text-[8.5px] font-mono font-bold tracking-tight">
                {pdb.disruptionsAllowed > 0 ? `PDB: ${pdb.disruptionsAllowed}` : "PDB: 0!"}
              </span>
            </span>
          )}
        </div>

        {/* Right: Ambient CPU Load with integrated micro-meter */}
        <div
          className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded-md bg-[#23262D] shrink-0 ml-auto ${cpuColorClass}`}
          title={isWorkloadDead ? "No running containers (0% CPU)" : `Ambient CPU Load: ${cpuPct}%`}
        >
          <span className="font-mono text-[9px]">CPU {cpuPct}%</span>
          {!isWorkloadDead && (
            <div className="w-6 h-1 bg-[#191B20] rounded-full overflow-hidden shrink-0">
              <div
                className={`h-full rounded-full transition-all duration-300 ${cpuBarColor}`}
                style={{ width: `${Math.min(cpuPct, 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Dedicated Full-Width Pod Strip */}
      <div className="flex items-center gap-1 pt-1.5 border-t border-[#30343B]/40 min-h-[16px]">
        {isChaosActive && workloadFault?.faultType === "scale-down" && summaries.length === 0 ? (
          <span className="text-[8px] font-mono text-[#fc3f3f] font-semibold flex items-center gap-1">
            <ChaosIcon className="text-[10px]" />
            0/0 Outage
          </span>
        ) : summaries.length > 0 ? (
          <>
            <div className="flex items-center gap-1 flex-wrap overflow-hidden max-h-[16px]">
              {summaries.slice(0, 18).map((pod, idx) => {
                const podFault = getActivePodFault(activeChaosFaults, pod.name) || (workloadFault?.target === "pod" && workloadFault?.name === pod.name ? workloadFault : undefined);
                const isChaosImpacted = Boolean(podFault);

                const ph = pod.phase.toLowerCase();
                const isErr = ph.includes("crash") || ph.includes("oom") || ph.includes("error") || ph.includes("fail") || ph.includes("imagepull");
                const isPending = pod.isTerminating || ph.includes("pending") || (!pod.isReady && !isErr);

                const colorClass = isChaosImpacted
                  ? "bg-[#fc3f3f] ring-2 ring-[#fc3f3f]/80"
                  : isErr
                  ? "bg-[#fc3f3f]"
                  : isPending
                  ? "bg-[#F4C26B]"
                  : "bg-[#6DD6A8]";

                const tooltip = isChaosImpacted
                  ? `⚡ CHAOS FAULT ACTIVE (${podFault?.faultType || workloadFault?.faultType}): ${pod.name} (${pod.phase})`
                  : `${pod.name} (${pod.phase}${pod.restarts > 0 ? `, ${pod.restarts} restarts` : ""})`;

                return (
                  <button
                    key={pod.name || idx}
                    onClick={(e) => handlePodGlyphClick(e, pod.podData)}
                    title={tooltip}
                    className={`h-2.5 w-2.5 rounded-[3px] transition-transform duration-150 hover:scale-135 hover:z-20 cursor-pointer ${colorClass}`}
                  />
                );
              })}
            </div>
            {summaries.length > 18 && (
              <span className="text-[8px] font-mono text-zinc-400 pl-0.5 shrink-0" title={`${summaries.length} total pods`}>
                +{summaries.length - 18}
              </span>
            )}
          </>
        ) : (
          <span className="text-[8.5px] font-mono text-zinc-600 italic">No pods</span>
        )}
      </div>
    </div>
  );
}

K8sGroupNode.displayName = "K8sGroupNode";
