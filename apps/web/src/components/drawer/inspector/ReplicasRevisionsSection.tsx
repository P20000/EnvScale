import { useState } from "react";
import {
  MdLayers as LayersIcon,
  MdSync as SyncIcon,
  MdHistory as UndoIcon,
  MdWarning as AlertTriangle,
} from "react-icons/md";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { calculateRolloutInfo, type RevisionItem } from "../../../store/helpers/rolloutHelpers";
import { apiRollbackDeployment } from "../../../config/api";

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
  const activeCluster = useTopologyStore((s) => s.activeCluster);

  const [confirmRollbackTarget, setConfirmRollbackTarget] = useState<string | null>(null);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

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

  const handleRollback = async (rev: RevisionItem) => {
    if (!activeCluster) {
      setFeedback({ type: "error", message: "No active cluster selected" });
      return;
    }
    setIsRollingBack(true);
    setFeedback(null);
    try {
      const res = await apiRollbackDeployment({
        clusterId: activeCluster,
        namespace,
        deploymentName: workloadName,
        replicaSetName: rev.name,
      });
      if (res.success) {
        setFeedback({
          type: "success",
          message: res.message || `Rollback triggered to revision #${rev.hash} (${rev.name})`,
        });
        setConfirmRollbackTarget(null);
      } else {
        setFeedback({
          type: "error",
          message: res.error || "Rollback request failed",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rollback failed";
      setFeedback({ type: "error", message: msg });
    } finally {
      setIsRollingBack(false);
    }
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

      {feedback && (
        <div
          className={`rounded-lg border p-2.5 text-xs font-mono flex items-center justify-between gap-2 ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <span className="truncate">{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-neutral-400 hover:text-neutral-200 text-xs shrink-0 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

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
                  <span className="text-neutral-200 font-bold truncate max-w-[150px]" title={rev.name}>
                    {rev.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 px-1 py-0.2 rounded bg-neutral-800 border border-neutral-700">
                    #{rev.hash}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isCurrent && confirmRollbackTarget !== rev.name && (
                    <button
                      onClick={() => {
                        setConfirmRollbackTarget(rev.name);
                        setFeedback(null);
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-amber-500/20 hover:border-amber-500/40 hover:text-amber-300 transition-colors flex items-center gap-1 cursor-pointer font-sans"
                    >
                      <UndoIcon className="h-3 w-3" />
                      Rollback
                    </button>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusBadgeColor}`}>
                    {rev.status}
                  </span>
                </div>
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

              {confirmRollbackTarget === rev.name && (
                <div className="pt-2 mt-1 border-t border-neutral-800/80 bg-neutral-950/90 -mx-2.5 -mb-2.5 p-2.5 rounded-b-lg space-y-1.5">
                  <div className="text-[11px] text-amber-300 font-sans font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    Rollback to #{rev.hash}?
                  </div>
                  <p className="text-[10px] text-neutral-400 font-mono">
                    Restores deployment spec from {rev.name}.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      disabled={isRollingBack}
                      onClick={() => handleRollback(rev)}
                      className="px-2.5 py-1 rounded bg-amber-500 text-neutral-950 text-[11px] font-bold font-mono hover:bg-amber-400 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1"
                    >
                      {isRollingBack && <SyncIcon className="h-3 w-3 animate-spin" />}
                      Confirm Rollback
                    </button>
                    <button
                      disabled={isRollingBack}
                      onClick={() => setConfirmRollbackTarget(null)}
                      className="px-2 py-1 rounded bg-neutral-800 text-neutral-300 text-[11px] font-mono hover:bg-neutral-700 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

