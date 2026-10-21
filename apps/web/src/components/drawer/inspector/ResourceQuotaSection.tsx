import { MdSpeed as QuotaIcon } from "react-icons/md";
import type { K8sResourceQuotaData, K8sLimitRangeData } from "../../../store/types/topologyTypes";
import { formatBytes } from "../../../store/helpers/quotaHelpers";

interface ResourceQuotaSectionProps {
  quota: K8sResourceQuotaData | null;
  limitRanges?: K8sLimitRangeData[];
}

export function ResourceQuotaSection({ quota, limitRanges = [] }: ResourceQuotaSectionProps) {
  if (!quota && (!limitRanges || limitRanges.length === 0)) return null;

  const cpuPct = quota?.cpuUtilizationPct !== undefined ? Math.round(quota.cpuUtilizationPct) : 0;
  const memPct = quota?.memoryUtilizationPct !== undefined ? Math.round(quota.memoryUtilizationPct) : 0;
  const podsPct = quota?.podsUtilizationPct !== undefined ? Math.round(quota.podsUtilizationPct) : 0;

  const isBreached = quota?.isBreached || cpuPct >= 100 || memPct >= 100 || podsPct >= 100;
  const isWarning = quota?.isWarning || cpuPct >= 85 || memPct >= 85 || podsPct >= 85;

  const getBarColor = (pct: number) => {
    if (pct >= 100) return "bg-red-500";
    if (pct >= 85) return "bg-amber-500";
    if (pct >= 70) return "bg-yellow-500";
    return "bg-emerald-500";
  };

  const getTextColor = (pct: number) => {
    if (pct >= 100) return "text-red-400";
    if (pct >= 85) return "text-amber-400";
    if (pct >= 70) return "text-yellow-400";
    return "text-emerald-400";
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <QuotaIcon className="h-3.5 w-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider font-heading">
              Resource Quota & Governance
            </h4>
            <div className="text-[10px] text-neutral-400 font-mono">
              Namespace: <span className="text-neutral-300 font-medium">{quota?.namespace || "default"}</span>
            </div>
          </div>
        </div>

        {quota && (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${
              isBreached
                ? "bg-red-500/10 text-red-400 border-red-500/20"
                : isWarning
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            }`}
          >
            {isBreached ? "Quota Exceeded" : isWarning ? "Quota Warning" : "Within Quota"}
          </span>
        )}
      </div>

      {/* Quota Progress Metrics */}
      {quota && (
        <div className="space-y-2.5 pt-1">
          {/* CPU Metric */}
          {quota.cpuLimitCores !== undefined && quota.cpuLimitCores > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-neutral-400 font-medium">CPU Cores</span>
                <span className="font-mono text-neutral-300">
                  <span className={getTextColor(cpuPct)}>{quota.cpuUsedCores?.toFixed(2) ?? "0"}</span> /{" "}
                  {quota.cpuLimitCores.toFixed(2)} Cores ({cpuPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(cpuPct)}`}
                  style={{ width: `${Math.min(cpuPct, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Memory Metric */}
          {quota.memoryLimitBytes !== undefined && quota.memoryLimitBytes > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-neutral-400 font-medium">Memory Allocation</span>
                <span className="font-mono text-neutral-300">
                  <span className={getTextColor(memPct)}>{formatBytes(quota.memoryUsedBytes)}</span> /{" "}
                  {formatBytes(quota.memoryLimitBytes)} ({memPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(memPct)}`}
                  style={{ width: `${Math.min(memPct, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Pods Metric */}
          {quota.podsLimit !== undefined && quota.podsLimit > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-neutral-400 font-medium">Pod Capacity</span>
                <span className="font-mono text-neutral-300">
                  <span className={getTextColor(podsPct)}>{quota.podsUsed ?? 0}</span> / {quota.podsLimit} Pods (
                  {podsPct}%)
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
                <div
                  className={`h-full transition-all duration-300 ${getBarColor(podsPct)}`}
                  style={{ width: `${Math.min(podsPct, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* LimitRange Constraints Breakdown */}
      {limitRanges.length > 0 && (
        <div className="pt-2 border-t border-neutral-800/80 space-y-2">
          <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider font-heading">
            LimitRange Guardrails ({limitRanges[0].name})
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            {limitRanges.map((lr) =>
              lr.limits.map((lim, idx) => (
                <div
                  key={`${lr.name}-${idx}`}
                  className="col-span-2 rounded bg-neutral-950/60 p-2 border border-neutral-800 space-y-1"
                >
                  <div className="flex items-center justify-between text-neutral-300 font-sans font-medium text-[11px]">
                    <span>{lim.type} Limits</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-neutral-400 pt-0.5">
                    {lim.default && (
                      <div>
                        <span className="text-neutral-500">Default Limit:</span>{" "}
                        <span className="text-neutral-200">
                          {lim.default.cpu || "—"} / {lim.default.memory || "—"}
                        </span>
                      </div>
                    )}
                    {lim.defaultRequest && (
                      <div>
                        <span className="text-neutral-500">Default Req:</span>{" "}
                        <span className="text-neutral-200">
                          {lim.defaultRequest.cpu || "—"} / {lim.defaultRequest.memory || "—"}
                        </span>
                      </div>
                    )}
                    {lim.min && (
                      <div>
                        <span className="text-neutral-500">Min Bound:</span>{" "}
                        <span className="text-neutral-200">
                          {lim.min.cpu || "—"} / {lim.min.memory || "—"}
                        </span>
                      </div>
                    )}
                    {lim.max && (
                      <div>
                        <span className="text-neutral-500">Max Bound:</span>{" "}
                        <span className="text-neutral-200">
                          {lim.max.cpu || "—"} / {lim.max.memory || "—"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
