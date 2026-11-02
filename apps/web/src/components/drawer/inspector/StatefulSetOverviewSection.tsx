import React, { useState } from "react";
import {
  MdStorage as StorageIcon,
  MdDns as DnsIcon,
  MdContentCopy as CopyIcon,
  MdCheck as CheckIcon,
  MdTerminal as TerminalIcon,
  MdSync as SyncIcon,
  MdLayers as LayersIcon,
  MdCheckCircle as CheckCircle,
  MdWarning as AlertTriangle,
} from "react-icons/md";
import type { K8sStatefulSetNodeData } from "../../canvas/K8sStatefulSet";
import type { K8sPodData } from "../../canvas/K8sPod";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { extractOrdinalIndex } from "../../../store/helpers/statefulSetHelpers";

interface StatefulSetOverviewSectionProps {
  data: K8sStatefulSetNodeData;
  onOpenLogTerminal?: (podName: string, namespace?: string) => void;
}

export function StatefulSetOverviewSection({
  data,
  onOpenLogTerminal,
}: StatefulSetOverviewSectionProps) {
  const [copiedFqdn, setCopiedFqdn] = useState<string | null>(null);
  const pvcs = useTopologyStore((s) => s.pvcs);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);

  const totalReplicas = Math.max(data.replicas || 0, (data.pods || []).length);
  const readyReplicas = data.readyReplicas || 0;
  const isHealthy = readyReplicas === totalReplicas && totalReplicas > 0;
  const isProgressing = readyReplicas < totalReplicas;

  const currentRev = data.currentRevision || "rev-1";
  const updateRev = data.updateRevision || currentRev;
  const isRollingUpdate = data.updateRevision && data.currentRevision && data.updateRevision !== data.currentRevision;

  const sortedPods = [...(data.pods || [])].sort((a, b) => {
    const ordA = extractOrdinalIndex(a.name);
    const ordB = extractOrdinalIndex(b.name);
    return ordA - ordB;
  });

  const slotCount = Math.max(totalReplicas, sortedPods.length, 1);
  const ordinalSlots = Array.from({ length: slotCount }, (_, idx) => {
    const pod = sortedPods.find((p) => extractOrdinalIndex(p.name) === idx) || sortedPods[idx];
    return {
      ordinal: idx,
      pod,
    };
  });

  const vct = (data.volumeClaimTemplates && data.volumeClaimTemplates[0]) || {
    name: "data",
    storage: "10 Gi",
    accessModes: "RWO",
  };
  const serviceName = data.serviceName || "headless-service";
  const namespace = data.namespace || "default";

  const handleCopy = (fqdn: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fqdn);
    setCopiedFqdn(fqdn);
    setTimeout(() => setCopiedFqdn(null), 1500);
  };

  const handleSelectPod = (pod: K8sPodData) => {
    setSelectedNode({
      type: "pod",
      data: {
        ...pod,
        ownerName: data.name,
      },
    });
  };

  return (
    <div className="space-y-3.5">
      {/* 1. Controller Spec & Replicas */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <LayersIcon className="h-4 w-4 text-purple-400" />
            StatefulSet Status
          </h4>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border ${
              isHealthy
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : isProgressing
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-neutral-700 bg-neutral-800 text-neutral-400"
            }`}
          >
            {isHealthy ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {readyReplicas}/{totalReplicas} Replicas Ready
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Desired Replicas</span>
            <span className="font-mono text-neutral-200 font-semibold">{data.replicas ?? 1}</span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Ready Replicas</span>
            <span className={`font-mono font-semibold ${isHealthy ? "text-emerald-400" : "text-amber-400"}`}>
              {readyReplicas}
            </span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Current Replicas</span>
            <span className="font-mono text-neutral-200 font-semibold">
              {data.currentReplicas ?? readyReplicas}
            </span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Updated Replicas</span>
            <span className="font-mono text-neutral-200 font-semibold">
              {data.updatedReplicas ?? readyReplicas}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Revisions & Rollout Strategy */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <SyncIcon className={`h-4 w-4 ${isRollingUpdate ? "text-purple-400 animate-spin" : "text-neutral-400"}`} />
          Rollout Strategy & Controller Revisions
        </h4>
        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex justify-between items-center">
            <span className="text-neutral-400">Update Strategy:</span>
            <span className="text-purple-300 font-semibold">
              {data.updateStrategy || "RollingUpdate (OrderedReady)"}
            </span>
          </div>
          {typeof data.partition === "number" && (
            <div className="flex justify-between items-center">
              <span className="text-neutral-400">Canary Partition:</span>
              <span className="text-amber-300 font-semibold">Ordinal &gt;= {data.partition}</span>
            </div>
          )}
          <div className="flex justify-between items-center">
            <span className="text-neutral-400">Current Revision:</span>
            <span className="text-neutral-200 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
              {currentRev}
            </span>
          </div>
          {isRollingUpdate && (
            <div className="flex justify-between items-center">
              <span className="text-neutral-400">Target Update Revision:</span>
              <span className="text-purple-300 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-500/30">
                {updateRev}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 3. DNS Records & FQDN Directory */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <DnsIcon className="h-4 w-4 text-cyan-400" />
            Cluster DNS Records & FQDNs
          </h4>
          <span className="text-[10px] text-purple-300 font-mono font-medium">
            Svc: {serviceName}
          </span>
        </div>
        <p className="text-[10.5px] text-neutral-400">
          Stateful ordinal pods have deterministic network identities via headless service DNS (direct A/SRV records).
        </p>

        <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
          {ordinalSlots.map((slot) => {
            const podName = slot.pod?.name || `${data.name}-${slot.ordinal}`;
            const fqdn = `${podName}.${serviceName}.${namespace}.svc.cluster.local`;
            const isCopied = copiedFqdn === fqdn;

            return (
              <div
                key={slot.ordinal}
                onClick={(e) => handleCopy(fqdn, e)}
                className="flex items-center justify-between p-2 rounded bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors cursor-pointer group text-xs font-mono"
                title="Click to copy cluster FQDN"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-purple-400 font-semibold shrink-0">#{slot.ordinal}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-neutral-200 font-semibold truncate max-w-[140px]">{podName}</span>
                    <span className="text-[10px] text-cyan-300 truncate max-w-[220px]" title={fqdn}>
                      {fqdn}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="text-neutral-400 group-hover:text-neutral-200 p-1 shrink-0 transition-colors"
                >
                  {isCopied ? <CheckIcon className="text-emerald-400 h-3.5 w-3.5" /> : <CopyIcon className="h-3 w-3" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Volume Claim Templates & Storage Specifications */}
      <div className="rounded-xl border border-cyan-500/20 bg-neutral-900/50 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <StorageIcon className="h-4 w-4 text-cyan-400" />
            Storage Specs & Volume Claims
          </h4>
          <span className="text-[10px] font-mono text-cyan-300 font-semibold">
            {vct.storage || "10 Gi"} ({vct.accessModes || "RWO"})
          </span>
        </div>

        <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
          {ordinalSlots.map((slot) => {
            const podName = slot.pod?.name || `${data.name}-${slot.ordinal}`;
            const expectedPvcName = `${vct.name}-${podName}`;
            const matchedPvc = pvcs.find(
              (p) => p.name === expectedPvcName || (p.name.includes(vct.name) && p.name.includes(`-${slot.ordinal}`))
            );
            const phase = matchedPvc?.phase || (slot.pod ? "Bound" : "Pending");
            const isBound = phase.toLowerCase() === "bound";

            return (
              <div
                key={slot.ordinal}
                className="flex items-center justify-between p-2 rounded bg-neutral-950 border border-neutral-800 text-xs font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-purple-400 font-semibold shrink-0">#{slot.ordinal}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-neutral-200 truncate">{expectedPvcName}</span>
                    <span className="text-[10px] text-neutral-400">
                      Claim: {vct.name} • {String(matchedPvc?.capacity || matchedPvc?.requestedSize || vct.storage || "10 Gi")}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold shrink-0 border ${
                    isBound
                      ? "text-cyan-300 bg-cyan-500/10 border-cyan-500/20"
                      : "text-amber-300 bg-amber-500/10 border-amber-500/20"
                  }`}
                >
                  {phase}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. Ordinal Pod Fleet & Scheduling Details */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Ordinal Pod Fleet & Scheduling ({ordinalSlots.length})
        </h4>

        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
          {ordinalSlots.map((slot) => {
            const pod = slot.pod;
            const podName = pod?.name || `${data.name}-${slot.ordinal}`;
            const podIp = pod?.podIp || pod?.ip || "Unassigned";
            const nodeName = pod?.nodeName || "worker-1";
            const status = pod?.phase || pod?.status || "Running";
            const isRunning = String(status).toLowerCase() === "running";

            return (
              <div
                key={slot.ordinal}
                className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs font-mono space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-purple-400 font-bold">#{slot.ordinal}</span>
                    <span className="text-neutral-200 font-semibold truncate max-w-[150px]">{podName}</span>
                  </div>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                      isRunning
                        ? "text-emerald-300 bg-emerald-500/10 border border-emerald-500/20"
                        : "text-amber-300 bg-amber-500/10 border border-amber-500/20"
                    }`}
                  >
                    {status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-neutral-400 pt-0.5">
                  <div>
                    <span>IP: </span>
                    <span className="text-neutral-200">{podIp}</span>
                  </div>
                  <div>
                    <span>Node: </span>
                    <span className="text-neutral-200">{nodeName}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-neutral-800/80">
                  {pod && (
                    <button
                      onClick={() => handleSelectPod(pod)}
                      className="text-[10px] text-neutral-300 hover:text-white px-2 py-0.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 transition-colors"
                    >
                      Inspect Pod
                    </button>
                  )}
                  {onOpenLogTerminal && (
                    <button
                      onClick={() => onOpenLogTerminal(podName, namespace)}
                      className="text-[10px] text-blue-300 hover:text-blue-200 px-2 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 transition-colors flex items-center gap-1"
                    >
                      <TerminalIcon className="text-xs" />
                      Logs
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
