import React, { useState } from "react";
import {
  MdDns as DnsIcon,
  MdStorage as StorageIcon,
  MdContentCopy as CopyIcon,
  MdCheck as CheckIcon,
} from "react-icons/md";
import type { K8sPodData } from "../../canvas/K8sPod";
import { useTopologyStore } from "../../../store/useTopologyStore";
import {
  extractOrdinalIndex,
  findWorkloadStatefulSet,
  generateOrdinalFqdn,
} from "../../../store/helpers/statefulSetHelpers";

interface StatefulPodDetailsSectionProps {
  pod: K8sPodData;
}

export function StatefulPodDetailsSection({ pod }: StatefulPodDetailsSectionProps) {
  const [copiedFqdn, setCopiedFqdn] = useState(false);
  const statefulSets = useTopologyStore((s) => s.statefulSets);
  const pvcs = useTopologyStore((s) => s.pvcs);

  const ordinal = extractOrdinalIndex(pod.name);
  if (ordinal < 0) return null;

  const prefix = pod.name.replace(/-(0|[1-9]\d*)$/, "");
  const matchedSts =
    findWorkloadStatefulSet(statefulSets, prefix, pod.namespace) ||
    findWorkloadStatefulSet(statefulSets, pod.ownerName || "", pod.namespace);

  const serviceName = matchedSts?.serviceName || "headless-service";
  const namespace = pod.namespace || matchedSts?.namespace || "default";
  const fqdn = generateOrdinalFqdn(pod.name, serviceName, namespace);

  const vct = (matchedSts?.volumeClaimTemplates && matchedSts.volumeClaimTemplates[0]) || {
    name: "data",
    storage: "10 Gi",
    accessModes: "RWO",
  };
  const expectedPvcName = `${vct.name}-${pod.name}`;
  const matchedPvc = pvcs.find(
    (p) => p.name === expectedPvcName || (p.name.includes(vct.name) && p.name.includes(`-${ordinal}`))
  );
  const pvcPhase = matchedPvc?.phase || "Bound";
  const isBound = pvcPhase.toLowerCase() === "bound";

  const handleCopyFqdn = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(fqdn);
    setCopiedFqdn(true);
    setTimeout(() => setCopiedFqdn(false), 1500);
  };

  return (
    <div className="rounded-xl border border-purple-500/30 bg-purple-950/15 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
          <DnsIcon className="h-4 w-4 text-purple-400" />
          Stateful Ordinal &amp; Network Identity
        </h4>
        <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-bold">
          BAY #{ordinal}
        </span>
      </div>

      {/* Cluster FQDN Record */}
      <div className="space-y-1 text-xs font-mono">
        <span className="text-neutral-400 text-[10px] block">Cluster DNS Record (FQDN):</span>
        <div
          onClick={handleCopyFqdn}
          className="flex items-center justify-between p-2 rounded bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors cursor-pointer group"
          title="Click to copy cluster FQDN"
        >
          <span className="text-cyan-300 truncate max-w-[280px]" title={fqdn}>
            {fqdn}
          </span>
          <button type="button" className="text-neutral-400 group-hover:text-neutral-200 p-0.5 shrink-0">
            {copiedFqdn ? <CheckIcon className="text-emerald-400 text-xs" /> : <CopyIcon className="text-xs" />}
          </button>
        </div>
      </div>

      {/* Persistent Storage Claim 1:1 Affinity */}
      <div className="space-y-1 text-xs font-mono pt-1 border-t border-neutral-800/80">
        <div className="flex items-center justify-between text-[10px] text-neutral-400">
          <span>Attached PVC Claim:</span>
          <span className={isBound ? "text-cyan-300" : "text-amber-300"}>{pvcPhase}</span>
        </div>
        <div className="flex items-center justify-between p-2 rounded bg-neutral-950 border border-neutral-800">
          <div className="flex items-center gap-1.5 min-w-0">
            <StorageIcon className="text-cyan-400 text-xs shrink-0" />
            <span className="text-neutral-200 truncate">{expectedPvcName}</span>
          </div>
          <span className="text-[10px] text-neutral-400 shrink-0">
            {String(matchedPvc?.capacity || matchedPvc?.requestedSize || vct.storage || "10 Gi")} ({vct.accessModes || "RWO"})
          </span>
        </div>
      </div>
    </div>
  );
}
