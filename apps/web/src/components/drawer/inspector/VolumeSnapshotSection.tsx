import { useState } from "react";
import {
  MdCameraAlt as SnapshotIcon,
  MdLayers as LayersIcon,
  MdCloudQueue as CloudIcon,
  MdChevronRight as ChevronIcon,
  MdCheckCircle as ReadyIcon,
  MdHourglassEmpty as PendingIcon,
  MdErrorOutline as ErrorIcon,
  MdShare as BranchIcon,
} from "react-icons/md";
import type { K8sPVCData, K8sVolumeSnapshotData, K8sVolumeSnapshotContentData } from "../../../store/types/topologyTypes";
import { useTopologyStore } from "../../../store/useTopologyStore";

interface VolumeSnapshotSectionProps {
  pvc: K8sPVCData;
}

export function VolumeSnapshotSection({ pvc }: VolumeSnapshotSectionProps) {
  const volumeSnapshots = useTopologyStore((s) => s.volumeSnapshots);
  const volumeSnapshotContents = useTopologyStore((s) => s.volumeSnapshotContents);
  const allPVCs = useTopologyStore((s) => s.pvcs);

  const [expandedContentId, setExpandedContentId] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());

  // Identify all snapshots pointing to this persistent volume claim
  const snapshots: K8sVolumeSnapshotData[] = (volumeSnapshots || []).filter(
    (s) => s.pvcName === pvc.name && (s.namespace === pvc.namespace || !pvc.namespace)
  );

  // Identify any downstream PVCs cloned from snapshots belonging to this claim
  const clonedPVCs = (allPVCs || []).filter(
    (other) =>
      other.name !== pvc.name &&
      other.dataSource?.kind === "VolumeSnapshot" &&
      snapshots.some((s) => s.name === other.dataSource?.name)
  );

  const formatAge = (timestamp?: string) => {
    if (!timestamp) return "Unknown";
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    const diffSec = Math.floor((mountedAt - date.getTime()) / 1000);
    if (diffSec < 60) return `${Math.max(0, diffSec)}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  };

  return (
    <div className="rounded-xl border border-purple-500/20 bg-zinc-900/60 p-3.5 space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-purple-200 uppercase tracking-wider flex items-center gap-1.5">
          <SnapshotIcon className="h-4 w-4 text-purple-400" />
          Volume Snapshots & Recovery
        </h4>
        <span
          className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
            snapshots.length > 0
              ? "text-purple-300 bg-purple-500/10 border-purple-500/30"
              : "text-zinc-500 bg-zinc-800/40 border-zinc-700/40"
          }`}
        >
          {snapshots.length} {snapshots.length === 1 ? "Snapshot" : "Snapshots"}
        </span>
      </div>

      {/* 1. Inbound Clone Provenance Banner (if this PVC was restored from a snapshot) */}
      {pvc.dataSource && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/40 text-xs">
          <BranchIcon className="h-4 w-4 text-purple-400 shrink-0 mt-0.5" />
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider">
              Restoration Lineage
            </span>
            <span className="text-zinc-200 font-mono text-[11px] truncate">
              Cloned from {pvc.dataSource.kind}: <strong className="text-purple-300">{pvc.dataSource.name}</strong>
            </span>
            {pvc.dataSource.apiGroup && (
              <span className="text-[9.5px] font-mono text-zinc-500">
                API Group: {pvc.dataSource.apiGroup}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Snapshot Timeline List */}
      {snapshots.length > 0 ? (
        <div className="space-y-2.5">
          {snapshots.map((snap) => {
            const isReady = snap.readyToUse === true;
            const isExpanded = expandedContentId === snap.name;

            // Match cluster-scoped physical VolumeSnapshotContent backing this snapshot
            const content: K8sVolumeSnapshotContentData | undefined = (volumeSnapshotContents || []).find(
              (c) =>
                c.name === snap.snapshotContentName ||
                c.volumeSnapshotRef === `${snap.namespace}/${snap.name}` ||
                c.volumeSnapshotRef === snap.name
            );

            return (
              <div
                key={snap.name}
                className="rounded-lg bg-zinc-950/80 border border-zinc-800/80 p-2.5 space-y-2 text-xs transition-colors hover:border-purple-500/40"
              >
                {/* Snapshot Header Row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isReady ? (
                      <ReadyIcon className="h-3.5 w-3.5 text-emerald-400 shrink-0" title="Ready to Use" />
                    ) : snap.error ? (
                      <ErrorIcon className="h-3.5 w-3.5 text-rose-400 shrink-0" title="Snapshot Failed" />
                    ) : (
                      <PendingIcon className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" title="Snapshot In-Progress" />
                    )}
                    <span className="font-mono font-semibold text-zinc-200 truncate" title={snap.name}>
                      {snap.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[8.5px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                        isReady
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : snap.error
                          ? "text-rose-400 bg-rose-500/10 border border-rose-500/20"
                          : "text-amber-400 bg-amber-500/10 border border-amber-500/20"
                      }`}
                    >
                      {isReady ? "Ready" : snap.error ? "Failed" : "Pending"}
                    </span>
                    <span className="text-[9.5px] font-mono text-zinc-500">
                      {formatAge(snap.creationTime || snap.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Key Spec Grid */}
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-zinc-800/60 font-mono">
                  <div>
                    <span className="block text-zinc-500 text-[9.5px]">Restore Size</span>
                    <span className="text-purple-300 font-semibold">{snap.restoreSize || "Preserved"}</span>
                  </div>
                  <div>
                    <span className="block text-zinc-500 text-[9.5px]">Snapshot Class</span>
                    <span className="text-zinc-300 truncate block" title={snap.snapshotClassName || "Default"}>
                      {snap.snapshotClassName || "standard"}
                    </span>
                  </div>
                </div>

                {/* Error Banner if Snapshot creation failed */}
                {snap.error && (
                  <div className="p-1.5 rounded bg-rose-950/40 border border-rose-800/40 text-[10px] font-mono text-rose-300">
                    ⚠️ {snap.error}
                  </div>
                )}

                {/* CSI Physical Content Accordion Toggle */}
                {snap.snapshotContentName && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setExpandedContentId(isExpanded ? null : snap.name)}
                      className="w-full flex items-center justify-between py-1 px-1.5 rounded bg-zinc-900/60 hover:bg-zinc-800/60 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <span className="flex items-center gap-1">
                        <LayersIcon className="text-indigo-400" />
                        Physical VolumeSnapshotContent
                      </span>
                      <ChevronIcon className={`transform transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </button>

                    {isExpanded && (
                      <div className="mt-1.5 p-2 rounded bg-zinc-900/90 border border-zinc-800 text-[10px] font-mono space-y-1.5 text-zinc-300">
                        <div>
                          <span className="text-zinc-500 block text-[9px]">Cluster Resource</span>
                          <span className="text-indigo-300 font-semibold truncate block">{snap.snapshotContentName}</span>
                        </div>
                        {content?.driver && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">CSI Driver:</span>
                            <span className="text-zinc-200 font-semibold">{content.driver}</span>
                          </div>
                        )}
                        {content?.snapshotHandle && (
                          <div>
                            <span className="text-zinc-500 block text-[9px]">Storage Provider Snapshot ID:</span>
                            <span className="text-emerald-400 font-mono break-all">{content.snapshotHandle}</span>
                          </div>
                        )}
                        {content?.deletionPolicy && (
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-500">Deletion Policy:</span>
                            <span className="text-zinc-300">{content.deletionPolicy}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-zinc-950/50 border border-zinc-800/60 text-center space-y-1">
          <CloudIcon className="h-6 w-6 text-zinc-600 mx-auto" />
          <p className="text-xs text-zinc-400 font-mono">No VolumeSnapshots Recorded</p>
          <p className="text-[10px] text-zinc-500">
            Point-in-time snapshots created via snapshot.storage.k8s.io will automatically surface here.
          </p>
        </div>
      )}

      {/* 3. Outbound Downstream Clones (PVCs restored from snapshots of this claim) */}
      {clonedPVCs.length > 0 && (
        <div className="pt-2 border-t border-purple-500/20 space-y-1.5">
          <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-wider block">
            Derived Volume Clones ({clonedPVCs.length})
          </span>
          <div className="space-y-1">
            {clonedPVCs.map((clone) => (
              <div
                key={`${clone.namespace}-${clone.name}`}
                className="flex items-center justify-between p-1.5 rounded bg-zinc-950/60 border border-zinc-800 text-[10.5px] font-mono"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-purple-400">🌱</span>
                  <span className="text-zinc-200 truncate">{clone.name}</span>
                </div>
                <span className="text-[9px] text-zinc-500 px-1 py-0.5 rounded bg-zinc-900">
                  {clone.namespace}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
