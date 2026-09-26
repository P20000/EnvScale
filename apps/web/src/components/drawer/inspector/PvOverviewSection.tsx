import {
  MdOutlineSdStorage as PvIcon,
  MdCheckCircle as CheckCircle2,
  MdOutlineWarning as AlertTriangle,
  MdErrorOutline as AlertCircle,
  MdDns as DiskIcon,
  MdLabel as LabelIcon,
} from "react-icons/md";
import type { K8sPVData } from "../../../store/types/topologyTypes";

interface PvOverviewSectionProps {
  target: { type: "pv"; data: K8sPVData };
  nowMs: number;
}

export function PvOverviewSection({ target, nowMs }: PvOverviewSectionProps) {
  const pv = target.data;
  const rawRes = (pv.rawResource as Record<string, unknown>) || {};
  const rawSpec = (rawRes.spec as Record<string, unknown>) || {};
  const statusStr = String(pv.status || (rawRes.status as Record<string, unknown>)?.phase || "Available").trim();
  const statusLower = statusStr.toLowerCase();

  const isBound = statusLower === "bound";
  const isAvailable = statusLower === "available";
  const isFailed = statusLower === "failed";
  const isReleased = statusLower === "released";

  const statusColor = isBound
    ? "text-cyan-400"
    : isAvailable
    ? "text-emerald-400"
    : isReleased
    ? "text-amber-400"
    : isFailed
    ? "text-rose-400"
    : "text-zinc-400";

  const StatusIcon = isAvailable || isBound ? CheckCircle2 : isReleased ? AlertTriangle : AlertCircle;

  const getDynamicAge = () => {
    const createdRaw = pv.createdAt || (rawRes.metadata as Record<string, unknown>)?.creationTimestamp;
    if (!createdRaw) return null;
    const createdTime = new Date(String(createdRaw)).getTime();
    if (isNaN(createdTime)) return null;
    const diffMs = Math.max(0, nowMs - createdTime);
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // Extract claim reference
  const claimRef = pv.claimRef || (rawSpec.claimRef as { name?: string; namespace?: string } | undefined);
  const claimName = claimRef?.name || "Unbound";
  const claimNamespace = claimRef?.namespace;

  // Extract capacity, access modes, reclaim policy, volume mode, storage class
  const capacity =
    pv.capacity ||
    ((rawSpec.capacity as Record<string, string>)?.storage as string) ||
    "Not specified";
  const accessModes =
    Array.isArray(pv.accessModes) && pv.accessModes.length > 0
      ? pv.accessModes
      : Array.isArray(rawSpec.accessModes)
      ? (rawSpec.accessModes as string[])
      : ["ReadWriteOnce"];
  const reclaimPolicy =
    pv.reclaimPolicy || (rawSpec.persistentVolumeReclaimPolicy as string) || "Retain";
  const volumeMode = pv.volumeMode || (rawSpec.volumeMode as string) || "Filesystem";
  const storageClass = pv.storageClassName || (rawSpec.storageClassName as string) || "";

  // Extract Volume Source details from spec or data
  const detectVolumeSource = () => {
    if (pv.csiDriver || rawSpec.csi) {
      const csi = (rawSpec.csi || {}) as Record<string, unknown>;
      return {
        type: "CSI",
        driver: pv.csiDriver || (csi.driver as string) || "Unknown CSI Driver",
        volumeHandle: pv.csiVolumeHandle || (csi.volumeHandle as string),
        fsType: csi.fsType as string | undefined,
      };
    }
    if (rawSpec.awsElasticBlockStore) {
      const ebs = rawSpec.awsElasticBlockStore as Record<string, unknown>;
      return {
        type: "AWS EBS",
        volumeId: (ebs.volumeID as string) || (ebs.volumeId as string),
        fsType: ebs.fsType as string | undefined,
      };
    }
    if (pv.nfsServer || rawSpec.nfs) {
      const nfs = (rawSpec.nfs || {}) as Record<string, unknown>;
      return {
        type: "NFS",
        server: pv.nfsServer || (nfs.server as string),
        path: pv.nfsPath || (nfs.path as string),
      };
    }
    if (pv.localPath || rawSpec.local) {
      const local = (rawSpec.local || {}) as Record<string, unknown>;
      return {
        type: "Local",
        path: pv.localPath || (local.path as string),
      };
    }
    if (rawSpec.hostPath) {
      const hp = rawSpec.hostPath as Record<string, unknown>;
      return {
        type: "HostPath",
        path: hp.path as string,
      };
    }
    if (rawSpec.gcePersistentDisk) {
      const gce = rawSpec.gcePersistentDisk as Record<string, unknown>;
      return {
        type: "GCE Persistent Disk",
        pdName: gce.pdName as string,
        fsType: gce.fsType as string,
      };
    }
    if (rawSpec.azureDisk) {
      const az = rawSpec.azureDisk as Record<string, unknown>;
      return {
        type: "Azure Disk",
        diskName: az.diskName as string,
      };
    }
    if (pv.volumeSource) {
      return {
        type: pv.volumeSource,
      };
    }
    return null;
  };

  const volumeSourceInfo = detectVolumeSource();

  const labels =
    pv.labels ||
    ((rawRes.metadata as Record<string, unknown>)?.labels as Record<string, string>) ||
    {};
  const annotations =
    pv.annotations ||
    ((rawRes.metadata as Record<string, unknown>)?.annotations as Record<string, string>) ||
    {};

  return (
    <div className="space-y-4">
      {/* 1. Core PV Details Card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <PvIcon className="h-4 w-4 text-violet-400" />
          PersistentVolume Spec
        </h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Volume Name</span>
            <span className="font-mono text-neutral-200 font-medium truncate block" title={pv.name}>
              {pv.name}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Status</span>
            <span className={`inline-flex items-center gap-1 font-semibold ${statusColor}`}>
              <StatusIcon className="h-3 w-3" />
              {statusStr}
            </span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Capacity</span>
            <span className="font-mono text-violet-300 font-semibold">{capacity}</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Reclaim Policy</span>
            <span className="font-mono text-neutral-200">{reclaimPolicy}</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">Volume Mode</span>
            <span className="font-mono text-neutral-200">{volumeMode}</span>
          </div>

          <div>
            <span className="block text-neutral-400 text-[10px]">StorageClass</span>
            <span className="font-mono text-indigo-300 font-medium truncate block" title={storageClass || "None"}>
              {storageClass || "None"}
            </span>
          </div>

          {claimName !== "Unbound" && (
            <div className="col-span-2">
              <span className="block text-neutral-400 text-[10px]">Claim Reference</span>
              <span className="font-mono text-cyan-300 font-medium">
                {claimNamespace ? `${claimNamespace} / ${claimName}` : claimName}
              </span>
            </div>
          )}

          <div>
            <span className="block text-neutral-400 text-[10px]">Scope</span>
            <span className="font-mono text-neutral-300">Cluster-scoped</span>
          </div>

          {getDynamicAge() && (
            <div>
              <span className="block text-neutral-400 text-[10px]">Age</span>
              <span className="font-mono text-neutral-200">{getDynamicAge()}</span>
            </div>
          )}
        </div>

        {/* Access Modes Badges */}
        <div className="pt-2 border-t border-neutral-800/60">
          <span className="block text-neutral-400 text-[10px] mb-1.5">Access Modes</span>
          <div className="flex flex-wrap gap-1.5">
            {accessModes.map((mode) => (
              <span
                key={mode}
                className="px-2 py-0.5 rounded bg-violet-950/40 border border-violet-800/40 text-[11px] font-mono text-violet-300"
              >
                {mode}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Physical / Backend Storage Information Card */}
      {volumeSourceInfo && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <DiskIcon className="h-4 w-4 text-cyan-400" />
            Backend Storage Source ({volumeSourceInfo.type})
          </h4>
          <div className="space-y-1.5 text-xs font-mono">
            {"driver" in volumeSourceInfo && volumeSourceInfo.driver && (
              <div>
                <span className="text-neutral-400 text-[10px] block">CSI Driver</span>
                <span className="text-zinc-200 font-semibold break-all">{volumeSourceInfo.driver}</span>
              </div>
            )}
            {"volumeHandle" in volumeSourceInfo && volumeSourceInfo.volumeHandle && (
              <div>
                <span className="text-neutral-400 text-[10px] block">Volume Handle</span>
                <span className="text-neutral-300 break-all">{volumeSourceInfo.volumeHandle}</span>
              </div>
            )}
            {"volumeId" in volumeSourceInfo && volumeSourceInfo.volumeId && (
              <div>
                <span className="text-neutral-400 text-[10px] block">EBS Volume ID</span>
                <span className="text-neutral-300 break-all">{volumeSourceInfo.volumeId}</span>
              </div>
            )}
            {"server" in volumeSourceInfo && volumeSourceInfo.server && (
              <div>
                <span className="text-neutral-400 text-[10px] block">NFS Server</span>
                <span className="text-neutral-300">{volumeSourceInfo.server}</span>
              </div>
            )}
            {"path" in volumeSourceInfo && volumeSourceInfo.path && (
              <div>
                <span className="text-neutral-400 text-[10px] block">Export / Local Path</span>
                <span className="text-neutral-300">{volumeSourceInfo.path}</span>
              </div>
            )}
            {"pdName" in volumeSourceInfo && volumeSourceInfo.pdName && (
              <div>
                <span className="text-neutral-400 text-[10px] block">GCE PD Name</span>
                <span className="text-neutral-300">{volumeSourceInfo.pdName}</span>
              </div>
            )}
            {"diskName" in volumeSourceInfo && volumeSourceInfo.diskName && (
              <div>
                <span className="text-neutral-400 text-[10px] block">Azure Disk</span>
                <span className="text-neutral-300">{volumeSourceInfo.diskName}</span>
              </div>
            )}
            {"fsType" in volumeSourceInfo && volumeSourceInfo.fsType && (
              <div>
                <span className="text-neutral-400 text-[10px] block">Filesystem</span>
                <span className="text-neutral-300">{volumeSourceInfo.fsType}</span>
              </div>
            )}
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
