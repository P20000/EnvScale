import { MdStorage as StorageIcon, MdLink as LinkIcon, MdInfoOutline as InfoIcon } from "react-icons/md";
import type { K8sPVCData, K8sPVData } from "../../../store/types/topologyTypes";
import type { K8sPodData } from "../../canvas/K8sPod";
import { useTopologyStore } from "../../../store/useTopologyStore";

interface StorageOverviewSectionProps {
  pvc: K8sPVCData;
}

export function StorageOverviewSection({ pvc }: StorageOverviewSectionProps) {
  const pods = useTopologyStore((s) => s.pods);
  const pvs = useTopologyStore((s) => s.pvs);

  // Look up corresponding physical PersistentVolume backing this claim
  const boundPV: K8sPVData | undefined = pvs.find(
    (pv) => pv.name === pvc.volumeName || (pv.claimRefName === pvc.name && pv.claimRefNs === pvc.namespace)
  );

  // Identify all active pods mounting this PVC
  const mountedPods: { pod: K8sPodData; mountPath?: string; readOnly?: boolean }[] = [];
  pods.forEach((p) => {
    if (p.namespace === pvc.namespace && p.volumes) {
      const match = p.volumes.find((v) => v.pvcName === pvc.name);
      if (match) {
        mountedPods.push({ pod: p, mountPath: match.mountPath, readOnly: match.readOnly });
      }
    }
  });

  const phaseClass =
    pvc.phase === "Bound"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : pvc.phase === "Pending"
      ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
      : "text-rose-400 bg-rose-500/10 border-rose-500/30";

  return (
    <div className="space-y-3.5">
      {/* 1. PVC Specifications Card */}
      <div className="rounded-xl border border-cyan-500/20 bg-zinc-900/60 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
            <StorageIcon className="h-4 w-4 text-cyan-400" />
            Storage Claim Spec
          </h4>
          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${phaseClass}`}>
            {pvc.phase}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-zinc-500 text-[10px]">Claim Name</span>
            <span className="font-mono text-zinc-200 font-semibold truncate block" title={pvc.name}>
              {pvc.name}
            </span>
          </div>
          <div>
            <span className="block text-zinc-500 text-[10px]">Namespace</span>
            <span className="font-mono text-zinc-300 font-medium">
              {pvc.namespace || "default"}
            </span>
          </div>
          <div>
            <span className="block text-zinc-500 text-[10px]">Capacity (Allocated)</span>
            <span className="font-mono text-cyan-300 font-bold">
              {pvc.capacity || pvc.requestedSize || "Dynamic"}
            </span>
          </div>
          <div>
            <span className="block text-zinc-500 text-[10px]">StorageClass</span>
            <span className="font-mono text-zinc-300 font-medium">
              {pvc.storageClassName || "cluster-default"}
            </span>
          </div>
          <div>
            <span className="block text-zinc-500 text-[10px]">Access Modes</span>
            <span className="font-mono text-zinc-300 text-[11px]">
              {(pvc.accessModes || ["ReadWriteOnce"]).join(", ")}
            </span>
          </div>
          <div>
            <span className="block text-zinc-500 text-[10px]">Volume Mode</span>
            <span className="font-mono text-zinc-300 text-[11px]">
              {pvc.volumeMode || "Filesystem"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Physical PersistentVolume (PV) Details Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <InfoIcon className="h-4 w-4 text-indigo-400" />
          Backing Physical Volume (PV)
        </h4>

        {pvc.volumeName ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="col-span-2">
              <span className="block text-zinc-500 text-[10px]">Bound PV Resource</span>
              <span className="font-mono text-indigo-300 font-semibold truncate block">
                {pvc.volumeName}
              </span>
            </div>
            <div>
              <span className="block text-zinc-500 text-[10px]">Reclaim Policy</span>
              <span className="font-mono text-zinc-200">
                {boundPV?.reclaimPolicy || "Delete"}
              </span>
            </div>
            <div>
              <span className="block text-zinc-500 text-[10px]">Driver / Source</span>
              <span className="font-mono text-zinc-200">
                {boundPV?.volumeSourceType || "Managed Storage"}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-amber-400/90 font-mono">
            Pending volume allocation by dynamic provisioner...
          </p>
        )}
      </div>

      {/* 3. Active Workload Pod Mounts Card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
            <LinkIcon className="h-4 w-4 text-cyan-400" />
            Active Mount Consumers ({mountedPods.length})
          </h4>
        </div>

        {mountedPods.length > 0 ? (
          <div className="space-y-2">
            {mountedPods.map(({ pod, mountPath, readOnly }) => (
              <div
                key={pod.name}
                className="flex items-center justify-between p-2 rounded-lg bg-zinc-950/70 border border-zinc-800/80 text-xs"
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="font-mono text-zinc-200 font-medium truncate" title={pod.name}>
                    {pod.name}
                  </span>
                  <span className="font-mono text-[10px] text-cyan-400/90 truncate" title={mountPath || "Mounted"}>
                    {mountPath ? `Mount: ${mountPath}` : "Attached volume"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                    {readOnly ? "RO" : "RW"}
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {pod.status || "Running"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 font-mono italic">
            No active pods currently mounting this claim in namespace {pvc.namespace || "default"}.
          </p>
        )}
      </div>
    </div>
  );
}
