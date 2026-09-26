import {
  MdLayers as StorageClassIcon,
  MdSettings as ParamIcon,
  MdLabel as LabelIcon,
} from "react-icons/md";
import type { K8sStorageClassData } from "../../../store/types/topologyTypes";

interface StorageClassOverviewSectionProps {
  target: { type: "storageclass"; data: K8sStorageClassData };
  nowMs: number;
}

export function StorageClassOverviewSection({ target, nowMs }: StorageClassOverviewSectionProps) {
  const sc = target.data;
  const rawRes = (sc.rawResource as Record<string, unknown>) || {};
  const provisioner = sc.provisioner || (rawRes.provisioner as string) || "kubernetes.io/no-provisioner";
  const reclaimPolicy = sc.reclaimPolicy || (rawRes.reclaimPolicy as string) || "Delete";
  const bindingMode = sc.volumeBindingMode || (rawRes.volumeBindingMode as string) || "Immediate";
  const allowVolumeExpansion =
    sc.allowVolumeExpansion ?? (rawRes.allowVolumeExpansion as boolean) ?? false;

  const getDynamicAge = () => {
    const createdRaw = sc.createdAt || (rawRes.metadata as Record<string, unknown>)?.creationTimestamp;
    if (!createdRaw) return null;
    const createdTime = new Date(String(createdRaw)).getTime();
    if (isNaN(createdTime)) return null;
    const diffMs = Math.max(0, nowMs - createdTime);
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const rawParameters =
    sc.parameters ||
    ((rawRes.parameters as Record<string, string>) || {});

  const labels =
    sc.labels ||
    ((rawRes.metadata as Record<string, unknown>)?.labels as Record<string, string>) ||
    {};
  const annotations =
    sc.annotations ||
    ((rawRes.metadata as Record<string, unknown>)?.annotations as Record<string, string>) ||
    {};

  return (
    <div className="space-y-4">
      {/* 1. Core StorageClass Details */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <StorageClassIcon className="h-4 w-4 text-indigo-400" />
          StorageClass Definition
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Class Name</span>
            <span className="font-mono text-neutral-200 font-medium truncate block" title={sc.name}>
              {sc.name}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Scope</span>
            <span className="font-mono text-neutral-300">Cluster-scoped</span>
          </div>

          <div className="col-span-2">
            <span className="block text-neutral-400 text-[10px]">Provisioner / Driver</span>
            <span className="font-mono text-indigo-300 font-medium break-all block" title={provisioner}>
              {provisioner}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Reclaim Policy</span>
            <span className="font-mono text-neutral-200">{reclaimPolicy}</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Volume Binding Mode</span>
            <span className="font-mono text-neutral-200">{bindingMode}</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Allow Expansion</span>
            <span
              className={`font-mono font-semibold ${
                allowVolumeExpansion ? "text-emerald-400" : "text-neutral-400"
              }`}
            >
              {allowVolumeExpansion ? "Enabled" : "Disabled"}
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

      {/* 2. Provisioner Parameters */}
      {Object.keys(rawParameters).length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <ParamIcon className="h-4 w-4 text-neutral-400" />
            Provisioner Parameters
          </h4>
          <div className="space-y-1.5 text-xs font-mono">
            {Object.entries(rawParameters).map(([key, val]) => (
              <div
                key={key}
                className="flex items-center justify-between p-2 rounded bg-neutral-950/60 border border-neutral-800/80"
              >
                <span className="text-neutral-400 text-[11px]">{key}</span>
                <span className="text-zinc-200 font-semibold text-[11px] truncate max-w-[200px]" title={val}>
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Metadata (Labels & Annotations) */}
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
