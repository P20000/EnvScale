import { useState } from "react";
import Icon from "@mdi/react";
import {
  mdiCpu64Bit,
  mdiMemory,
  mdiRefresh,
  mdiPencil,
  mdiTrashCanOutline,
  mdiPlay,
  mdiPause,
  mdiAlertCircle,
  mdiAlert,
  mdiCheckCircle,
} from "@mdi/js";
import { useAlertStore } from "../../store/useAlertStore";
import { cn } from "../../lib/utils";
import type { AlertRule } from "../../types/alerts";

interface AlertRuleListProps {
  onEditRule: (rule: AlertRule) => void;
}

export function AlertRuleList({ onEditRule }: AlertRuleListProps) {
  const alertRules = useAlertStore((s) => s.alertRules);
  const deleteAlertRule = useAlertStore((s) => s.deleteAlertRule);
  const toggleAlertRule = useAlertStore((s) => s.toggleAlertRule);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const getMetricIconPath = (metric: string) => {
    switch (metric) {
      case "cpu":
        return mdiCpu64Bit;
      case "memory":
        return mdiMemory;
      case "pod_crash":
        return mdiRefresh;
      default:
        return mdiCpu64Bit;
    }
  };

  const getOperatorSymbol = (op: string) => {
    switch (op) {
      case "greater_than":
        return ">";
      case "less_than":
        return "<";
      case "greater_than_or_equal":
        return "≥";
      case "less_than_or_equal":
        return "≤";
      default:
        return "=";
    }
  };

  const getMetricLabel = (metric: string) => {
    switch (metric) {
      case "cpu":
        return "CPU";
      case "memory":
        return "Memory";
      case "pod_crash":
        return "Pod Restarts";
      default:
        return metric;
    }
  };

  const handleConfirmDelete = (id: string) => {
    deleteAlertRule(id);
    setDeleteConfirmId(null);
  };

  if (alertRules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border border-neutral-800 rounded-2xl bg-surface">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-background text-neutral-400 border border-neutral-800 mb-4">
          <Icon path={mdiRefresh} size={1} />
        </div>
        <h4 className="text-sm font-semibold text-neutral-300 font-heading">No Alert Rules Configured</h4>
        <p className="text-xs text-neutral-500 max-w-sm mt-1 mb-5">
          Add custom evaluation thresholds for CPU, memory, and container restarts to secure your cluster workloads.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {alertRules.map((rule) => {
        const metricPath = getMetricIconPath(rule.metric);
        const opSymbol = getOperatorSymbol(rule.operator);
        const isConfirmingDelete = deleteConfirmId === rule.id;

        const sevBadge =
          rule.severity === "critical" ? (
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold border rounded-full bg-red-500/5 text-red-400 border-red-500/20">
              <Icon path={mdiAlertCircle} size={0.5} />
              <span>Critical</span>
            </div>
          ) : rule.severity === "warning" ? (
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold border rounded-full bg-amber-500/5 text-amber-400 border-amber-500/20">
              <Icon path={mdiAlert} size={0.5} />
              <span>High</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold border rounded-full bg-blue-500/5 text-blue-400 border-blue-500/20">
              <Icon path={mdiCheckCircle} size={0.5} />
              <span>Info</span>
            </div>
          );

        return (
          <div
            key={rule.id}
            className={cn(
              "relative rounded-2xl border border-neutral-800 bg-surface p-4 flex flex-col justify-between transition-colors",
              !rule.enabled && "opacity-60"
            )}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-neutral-100 truncate font-heading" title={rule.name}>
                  {rule.name}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  {sevBadge}
                  <span className="text-[10px] text-neutral-400 font-mono">
                    in {rule.namespace === "all" ? "All Namespaces" : `"${rule.namespace}"`}
                  </span>
                </div>
              </div>

              {/* Status Toggle Switch */}
              <button
                onClick={() => toggleAlertRule(rule.id)}
                title={rule.enabled ? "Disable Rule" : "Enable Rule"}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider transition-colors",
                  rule.enabled
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                    : "bg-background text-neutral-500 border-neutral-800 hover:bg-neutral-800"
                )}
              >
                {rule.enabled ? (
                  <>
                    <Icon path={mdiPlay} size={0.5} />
                    <span>Active</span>
                  </>
                ) : (
                  <>
                    <Icon path={mdiPause} size={0.5} />
                    <span>Paused</span>
                  </>
                )}
              </button>
            </div>

            {/* Condition row */}
            <div className="flex items-center gap-2.5 rounded-md bg-background border border-neutral-800 px-3 py-2.5 mb-4 text-xs font-mono">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-surface border border-neutral-800 text-neutral-400 shrink-0">
                <Icon path={metricPath} size={0.65} />
              </div>
              <div className="min-w-0 flex-1 leading-normal">
                <span className="font-bold text-neutral-200">{getMetricLabel(rule.metric)}</span>{" "}
                <span className="text-blue-400 font-bold">{opSymbol}</span>{" "}
                <span className="font-bold text-neutral-200">
                  {rule.threshold}
                  {rule.metric === "pod_crash" ? "" : "%"}
                </span>
                <span className="text-neutral-500 text-[10px] ml-1.5">
                  ({rule.duration === "Immediately" ? "immediately" : `for ${rule.duration}`})
                </span>
              </div>
            </div>

            {/* Footer row */}
            <div className="flex items-center justify-between border-t border-neutral-800 pt-3 mt-auto shrink-0">
              <span className="text-[10px] text-neutral-400 font-mono">
                Updated {new Date(rule.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>

              <div className="flex items-center gap-2">
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-red-400 font-medium">Delete policy?</span>
                    <button
                      onClick={() => handleConfirmDelete(rule.id)}
                      className="rounded-md bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-bold text-red-400 hover:bg-red-500/30 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded-md bg-background border border-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400 hover:bg-neutral-800 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => onEditRule(rule)}
                      className="flex items-center gap-1 rounded-md border border-neutral-800 bg-background px-2.5 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
                    >
                      <Icon path={mdiPencil} size={0.55} />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(rule.id)}
                      className="flex items-center gap-1 rounded-md border border-transparent px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Icon path={mdiTrashCanOutline} size={0.55} />
                      <span>Delete</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
