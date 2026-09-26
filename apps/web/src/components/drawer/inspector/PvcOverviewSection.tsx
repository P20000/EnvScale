import {
  MdStorage as StorageIcon,
  MdCheckCircle as CheckCircle2,
  MdOutlineWarning as AlertTriangle,
  MdErrorOutline as AlertCircle,
  MdViewInAr as PodIcon,
} from "react-icons/md";
import type { K8sPVCData } from "../../canvas/K8sPVC";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { getPodsMountingPVC } from "../../../store/helpers/storageTopologyHelpers";

interface PvcOverviewSectionProps {
  target: { type: "pvc"; data: K8sPVCData };
  nowMs: number;
}

export function PvcOverviewSection({ target, nowMs }: PvcOverviewSectionProps) {
  const pvc = target.data;
  const rawRes = (pvc.rawResource as Record<string, unknown>) || {};
  const statusStr = String(pvc.status || pvc.phase || "Bound").trim();
  const phaseLower = statusStr.toLowerCase();

  const isBound = phaseLower === "bound";
  const isPending = phaseLower === "pending";
  const isLost = phaseLower === "lost" || phaseLower.includes("fail") || phaseLower.includes("err");

  const statusColor = isBound
    ? "text-emerald-400"
    : isPending
    ? "text-amber-400"
    : isLost
    ? "text-rose-400"
    : "text-zinc-400";

  const StatusIcon = isBound
    ? CheckCircle2
    : isPending
    ? AlertTriangle
    : AlertCircle;

  // Retrieve mounting pods derived from frontend state
  const rawNodes = useTopologyStore((s) => s.rawNodes);
  const nodes = useTopologyStore((s) => s.nodes);
  const pods = useTopologyStore((s) => s.pods);
  const allPods = pods && pods.length > 0 ? pods : (rawNodes.length > 0 ? rawNodes : nodes);
  const mountedPods = getPodsMountingPVC(allPods, pvc.name, pvc.namespace);

  const getDynamicAge = () => {
    const createdRaw = pvc.createdAt || (rawRes.metadata as Record<string, unknown>)?.creationTimestamp;
    if (!createdRaw) return null;
    const createdTime = new Date(String(createdRaw)).getTime();
    if (isNaN(createdTime)) return null;
    const diffMs = Math.max(0, nowMs - createdTime);
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const requestedCapacity = pvc.requestedCapacity || pvc.capacity || "";
  const provisionedCapacity = pvc.actualCapacity || "";
  const storageClass = pvc.storageClassName || pvc.storageClass || "";
  const boundVolume = pvc.volumeName || "";
  const volumeMode = pvc.volumeMode || "Filesystem";
  const accessModes = Array.isArray(pvc.accessModes) && pvc.accessModes.length > 0 ? pvc.accessModes : ["ReadWriteOnce"];

  const labels = pvc.labels || ((rawRes.metadata as Record<string, unknown>)?.labels as Record<string, string>) || {};
  const annotations = pvc.annotations || ((rawRes.metadata as Record<string, unknown>)?.annotations as Record<string, string>) || {};
  const selector = pvc.selector || ((rawRes.spec as Record<string, unknown>)?.selector as Record<string, string>) || {};

  return (
    <div className="space-y-4">
      {/* 1. Core PVC Details Card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <StorageIcon className="h-4 w-4 text-cyan-400" />
          PersistentVolumeClaim Spec
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Claim Name</span>
            <span className="font-mono text-neutral-200 font-medium truncate block" title={pvc.name}>
              {pvc.name}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Namespace</span>
            <span className="font-mono text-neutral-200 font-medium">
              {pvc.namespace || "default"}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Phase / Status</span>
            <span className={`inline-flex items-center gap-1 font-semibold ${statusColor}`}>
              <StatusIcon className="h-3 w-3" />
              {statusStr}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Requested Capacity</span>
            <span className="font-mono text-cyan-300 font-semibold">
              {requestedCapacity || "Not specified"}
            </span>
          </div>

          {storageClass && (
            <div>
              <span className="block text-neutral-400 text-[10px]">StorageClass</span>
              <span className="font-mono text-violet-300 font-medium">
                {storageClass}
              </span>
            </div>
          )}

          <div>
            <span className="block text-neutral-400 text-[10px]">Volume Mode</span>
            <span className="font-mono text-neutral-200">
              {volumeMode}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Access Modes</span>
            <span className="font-mono text-neutral-300 text-[11px]">
              {accessModes.join(", ")}
            </span>
          </div>

          {getDynamicAge() && (
            <div>
              <span className="block text-neutral-400 text-[10px]">Age</span>
              <span className="font-mono text-neutral-200">
                {getDynamicAge()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Bound PersistentVolume Binding Status */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Volume Binding Status
        </h4>
        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex justify-between items-center">
            <span className="text-neutral-400">Bound PV:</span>
            {boundVolume ? (
              <span className="text-emerald-400 font-semibold">{boundVolume}</span>
            ) : (
              <span className="text-neutral-500 italic">None (Pending Binding)</span>
            )}
          </div>

          {provisionedCapacity && (
            <div className="flex justify-between items-center">
              <span className="text-neutral-400">Provisioned Capacity:</span>
              <span className="text-cyan-300 font-semibold">{provisionedCapacity}</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Mounted By Pods Section */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <PodIcon className="h-4 w-4 text-cyan-400" />
          Mounted By Pods ({mountedPods.length})
        </h4>
        {mountedPods.length === 0 ? (
          <p className="text-xs text-neutral-500 italic">
            No active pods currently mount this PersistentVolumeClaim.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {mountedPods.map((podName) => (
              <div
                key={podName}
                className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs font-mono"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span className="text-neutral-200 truncate">{podName}</span>
                </div>
                <span className="text-[10px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono shrink-0">
                  mounts
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Labels & Selectors (if present) */}
      {Object.keys(labels).length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
            Labels ({Object.keys(labels).length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(labels).map(([k, v]) => (
              <span
                key={k}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300 max-w-full truncate"
                title={`${k}=${v}`}
              >
                {k}: <span className="text-cyan-400">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 5. Annotations (if present) */}
      {Object.keys(annotations).length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
            Annotations ({Object.keys(annotations).length})
          </h4>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {Object.entries(annotations).map(([k, v]) => (
              <div
                key={k}
                className="text-[10px] font-mono p-1.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-400 break-all"
              >
                <span className="text-neutral-300 font-semibold">{k}:</span> {String(v)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Selector (if present) */}
      {Object.keys(selector).length > 0 && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
            Selector Match Labels
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(selector).map(([k, v]) => (
              <span
                key={k}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-950 border border-neutral-800 text-neutral-300"
              >
                {k} = <span className="text-emerald-400">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
