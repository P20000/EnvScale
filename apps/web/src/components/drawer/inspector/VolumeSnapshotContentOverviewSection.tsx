import {
  MdOutlineSnippetFolder as ContentIcon,
  MdLabel as LabelIcon,
} from "react-icons/md";
import type { K8sVolumeSnapshotContentData } from "../../../store/types/topologyTypes";

interface VolumeSnapshotContentOverviewSectionProps {
  target: { type: "volumesnapshotcontent"; data: K8sVolumeSnapshotContentData };
  nowMs: number;
}

export function VolumeSnapshotContentOverviewSection({
  target,
  nowMs,
}: VolumeSnapshotContentOverviewSectionProps) {
  const vsc = target.data;
  const rawRes = (vsc.rawResource as Record<string, unknown>) || {};
  const rawSpec = (rawRes.spec as Record<string, unknown>) || {};
  const rawStatus = (rawRes.status as Record<string, unknown>) || {};

  const driver = vsc.driver || (rawSpec.driver as string) || "csi";
  const deletionPolicy = vsc.deletionPolicy || (rawSpec.deletionPolicy as string) || "Delete";
  const snapshotHandle =
    vsc.snapshotHandle ||
    (rawStatus.snapshotHandle as string) ||
    ((rawSpec.source as Record<string, unknown>)?.snapshotHandle as string) ||
    "Not assigned";

  const sourceVolumeHandle =
    vsc.sourceVolumeHandle ||
    ((rawSpec.source as Record<string, unknown>)?.volumeHandle as string) ||
    "Not specified";

  const vsRef =
    vsc.volumeSnapshotRef ||
    (rawSpec.volumeSnapshotRef as { name?: string; namespace?: string } | undefined);

  const restoreSize =
    vsc.restoreSize ||
    (rawStatus.restoreSize as number | string) ||
    "Not reported";

  const getDynamicAge = () => {
    const createdRaw = vsc.createdAt || (rawRes.metadata as Record<string, unknown>)?.creationTimestamp;
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
    vsc.labels ||
    ((rawRes.metadata as Record<string, unknown>)?.labels as Record<string, string>) ||
    {};

  return (
    <div className="space-y-4">
      {/* 1. Core Content Details */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <ContentIcon className="h-4 w-4 text-slate-400" />
          VolumeSnapshotContent Spec
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Content Name</span>
            <span className="font-mono text-neutral-200 font-medium truncate block" title={vsc.name}>
              {vsc.name}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Scope</span>
            <span className="font-mono text-neutral-300">Cluster-scoped</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Driver</span>
            <span className="font-mono text-slate-200 font-medium truncate block" title={driver}>
              {driver}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Deletion Policy</span>
            <span className="font-mono text-neutral-200">{deletionPolicy}</span>
          </div>

          {vsRef && vsRef.name && (
            <div className="col-span-2">
              <span className="block text-neutral-400 text-[10px]">Associated VolumeSnapshot</span>
              <span className="font-mono text-teal-300 font-medium">
                {vsRef.namespace ? `${vsRef.namespace} / ${vsRef.name}` : vsRef.name}
              </span>
            </div>
          )}

          <div className="col-span-2">
            <span className="block text-neutral-400 text-[10px]">CSI Snapshot Handle</span>
            <span className="font-mono text-neutral-300 break-all">{snapshotHandle}</span>
          </div>

          {sourceVolumeHandle !== "Not specified" && (
            <div className="col-span-2">
              <span className="block text-neutral-400 text-[10px]">Source Volume Handle</span>
              <span className="font-mono text-neutral-300 break-all">{sourceVolumeHandle}</span>
            </div>
          )}

          <div>
            <span className="block text-neutral-400 text-[10px]">Restore Size</span>
            <span className="font-mono text-slate-300 font-semibold">{String(restoreSize)}</span>
          </div>

          {getDynamicAge() && (
            <div>
              <span className="block text-neutral-400 text-[10px]">Age</span>
              <span className="font-mono text-neutral-200">{getDynamicAge()}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Metadata (Labels) */}
      {Object.keys(labels).length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <LabelIcon className="h-4 w-4 text-neutral-400" />
            Metadata
          </h4>

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
        </div>
      )}
    </div>
  );
}
