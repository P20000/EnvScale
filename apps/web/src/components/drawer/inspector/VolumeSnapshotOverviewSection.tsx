import {
  MdCameraAlt as SnapshotIcon,
  MdCheckCircle as CheckCircle2,
  MdOutlineWarning as AlertTriangle,
  MdLabel as LabelIcon,
} from "react-icons/md";
import type { K8sVolumeSnapshotData } from "../../../store/types/topologyTypes";

interface VolumeSnapshotOverviewSectionProps {
  target: { type: "volumesnapshot"; data: K8sVolumeSnapshotData };
  nowMs: number;
}

export function VolumeSnapshotOverviewSection({ target, nowMs }: VolumeSnapshotOverviewSectionProps) {
  const vs = target.data;
  const rawRes = (vs.rawResource as Record<string, unknown>) || {};
  const rawSpec = (rawRes.spec as Record<string, unknown>) || {};
  const rawStatus = (rawRes.status as Record<string, unknown>) || {};

  const isReady = vs.readyToUse ?? (rawStatus.readyToUse as boolean) ?? false;
  const statusText = isReady ? "Ready to Use" : "Pending";
  const statusColor = isReady ? "text-teal-400" : "text-amber-400";
  const StatusIcon = isReady ? CheckCircle2 : AlertTriangle;

  const sourcePvc =
    vs.sourcePVCName ||
    ((rawSpec.source as Record<string, unknown>)?.persistentVolumeClaimName as string) ||
    "Not specified";

  const snapshotContentName =
    vs.snapshotContentName ||
    (rawStatus.boundVolumeSnapshotContentName as string) ||
    "Unbound";

  const snapshotClass =
    vs.volumeSnapshotClassName ||
    (rawSpec.volumeSnapshotClassName as string) ||
    "Default";

  const restoreSize =
    vs.restoreSize ||
    (rawStatus.restoreSize as string) ||
    "Not reported";

  const getDynamicAge = () => {
    const createdRaw = vs.createdAt || (rawRes.metadata as Record<string, unknown>)?.creationTimestamp;
    if (!createdRaw) return null;
    const createdTime = new Date(String(createdRaw)).getTime();
    if (isNaN(createdTime)) return null;
    const diffMs = Math.max(0, nowMs - createdTime);
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const labels =
    vs.labels ||
    ((rawRes.metadata as Record<string, unknown>)?.labels as Record<string, string>) ||
    {};
  const annotations =
    vs.annotations ||
    ((rawRes.metadata as Record<string, unknown>)?.annotations as Record<string, string>) ||
    {};

  return (
    <div className="space-y-4">
      {/* 1. Core VolumeSnapshot Details */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <SnapshotIcon className="h-4 w-4 text-teal-400" />
          VolumeSnapshot Spec
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Snapshot Name</span>
            <span className="font-mono text-neutral-200 font-medium truncate block" title={vs.name}>
              {vs.name}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Namespace</span>
            <span className="font-mono text-neutral-200 font-medium">
              {vs.namespace || "default"}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Status</span>
            <span className={`inline-flex items-center gap-1 font-semibold ${statusColor}`}>
              <StatusIcon className="h-3 w-3" />
              {statusText}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Restore Size</span>
            <span className="font-mono text-teal-300 font-semibold">{restoreSize}</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Source PVC</span>
            <span className="font-mono text-cyan-300 font-medium truncate block" title={sourcePvc}>
              {sourcePvc}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Snapshot Class</span>
            <span className="font-mono text-neutral-200">{snapshotClass}</span>
          </div>

          <div className="col-span-2">
            <span className="block text-neutral-400 text-[10px]">Bound Content Reference</span>
            <span className="font-mono text-slate-300 font-medium break-all block" title={snapshotContentName}>
              {snapshotContentName}
            </span>
          </div>

          {getDynamicAge() && (
            <div>
              <span className="block text-neutral-400 text-[10px]">Age</span>
              <span className="font-mono text-neutral-200">{getDynamicAge()}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Metadata (Labels & Annotations) */}
      {(Object.keys(labels).length > 0 || Object.keys(annotations).length > 0) && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <LabelIcon className="h-4 w-4 text-neutral-400" />
            Metadata
          </h4>

          {Object.keys(labels).length > 0 && (
            <div>
              <span className="block text-neutral-400 text-[10px] mb-1">Labels</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(labels).map(([k, v]) => (
                  <span
                    key={k}
                    className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-[10px] font-mono text-neutral-300 truncate max-w-[280px]"
                    title={`${k}=${v}`}
                  >
                    {k}: {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {Object.keys(annotations).length > 0 && (
            <div className="pt-2 border-t border-neutral-800/60">
              <span className="block text-neutral-400 text-[10px] mb-1">Annotations</span>
              <div className="space-y-1">
                {Object.entries(annotations).slice(0, 5).map(([k, v]) => (
                  <div key={k} className="text-[10px] font-mono text-neutral-400 truncate" title={`${k}: ${v}`}>
                    <span className="text-neutral-500">{k}:</span> {v}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
