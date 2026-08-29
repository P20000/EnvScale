import { MdLayers as LayersIcon, MdSync as SyncIcon } from "react-icons/md";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { calculateRolloutInfo } from "../../../store/helpers/rolloutHelpers";

interface ReplicasRevisionsSectionProps {
  workloadName: string;
  namespace?: string;
  nowMs: number;
}

export function ReplicasRevisionsSection({
  workloadName,
  namespace = "default",
  nowMs,
}: ReplicasRevisionsSectionProps) {
  const deployments = useTopologyStore((s) => s.deployments);
  const replicaSets = useTopologyStore((s) => s.replicaSets);

  const rolloutInfo = calculateRolloutInfo(workloadName, namespace, deployments, replicaSets);

  if (!rolloutInfo || rolloutInfo.allRevisions.length === 0) {
    return null;
  }

  const getAgeStr = (createdAt?: string) => {
    if (!createdAt) return "Unknown";
    const t = new Date(createdAt).getTime();
    if (isNaN(t)) return "Unknown";
    const diffMs = Math.max(0, nowMs - t);
    const m = Math.floor(diffMs / (1000 * 60));
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m ago`;
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
          <LayersIcon className="h-4 w-4 text-blue-400" />
          Replicas & Revisions ({rolloutInfo.allRevisions.length})
        </h4>

        {rolloutInfo.isRollingUpdate && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <SyncIcon className="h-3 w-3 animate-spin" />
            Rolling Update
          </span>
        )}

        {rolloutInfo.isStandaloneReplicaSet && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300">
            Standalone RS
          </span>
        )}
      </div>

      <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
        {rolloutInfo.allRevisions.map((rev) => {
          const isCurrent = rev.isCurrent;
          const isScalingUp = rev.status === "Scaling Up";
          const isScalingDown = rev.status === "Scaling Down";

          const statusBadgeColor = isScalingUp
            ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
            : isScalingDown
            ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
            : isCurrent
            ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
            : "text-neutral-500 border-neutral-800 bg-neutral-950";

          return (
            <div
              key={rev.name}
              className={`rounded-lg border p-2.5 text-xs font-mono space-y-1.5 transition-colors ${
                isCurrent
                  ? "border-neutral-700 bg-neutral-900"
                  : "border-neutral-800/80 bg-neutral-950/60 opacity-80"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-neutral-200 font-bold truncate max-w-[170px]" title={rev.name}>
                    {rev.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 px-1 py-0.2 rounded bg-neutral-800 border border-neutral-700">
                    #{rev.hash}
                  </span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadgeColor}`}>
                  {rev.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] pt-0.5">
                <div>
                  <span className="text-neutral-500 text-[10px] block">Replicas</span>
                  <span className="text-neutral-300 font-semibold">
                    {rev.readyReplicas} / {rev.desiredReplicas} ready
                  </span>
                </div>
                <div>
                  <span className="text-neutral-500 text-[10px] block">Age</span>
                  <span className="text-neutral-300">{getAgeStr(rev.createdAt)}</span>
                </div>
              </div>

              {rev.images && rev.images.length > 0 && (
                <div className="pt-0.5 border-t border-neutral-800/60">
                  <span className="text-neutral-500 text-[10px] block">Container Image</span>
                  <span className="text-blue-300 text-[10px] truncate block" title={rev.images.join(", ")}>
                    {rev.images.join(", ")}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
