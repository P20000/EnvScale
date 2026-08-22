import { useState } from "react";
import { Cpu, HardDrive, RefreshCw, Edit2, Trash2, Play, Pause } from "lucide-react";
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

  const getMetricIcon = (metric: string) => {
    switch (metric) {
      case "cpu":
        return Cpu;
      case "memory":
        return HardDrive;
      case "pod_crash":
        return RefreshCw;
      default:
        return Cpu;
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
      <div className="flex flex-col items-center justify-center p-12 text-center border border-neutral-850 rounded-2xl bg-neutral-900/10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-800 text-neutral-500 border border-neutral-700/50 mb-4 animate-pulse">
          <RefreshCw className="h-6 w-6" />
        </div>
        <h4 className="text-sm font-semibold text-neutral-300">No Alert Rules Configured</h4>
        <p className="text-xs text-neutral-500 max-w-sm mt-1 mb-5">
          Add custom evaluation thresholds for CPU, memory, and container restarts to secure your cluster workloads.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {alertRules.map((rule) => {
        const MetricIcon = getMetricIcon(rule.metric);
        const opSymbol = getOperatorSymbol(rule.operator);
        const isConfirmingDelete = deleteConfirmId === rule.id;

        // Colors based on severity
        const borderLeftColor =
          rule.severity === "critical"
            ? "border-l-red-500"
            : rule.severity === "warning"
            ? "border-l-amber-500"
            : "border-l-blue-500";

        const badgeColor =
          rule.severity === "critical"
            ? "bg-red-500/15 text-red-400 border-red-500/25"
            : rule.severity === "warning"
            ? "bg-amber-500/15 text-amber-400 border-amber-500/25"
            : "bg-blue-500/15 text-blue-400 border-blue-500/25";

        return (
          <div
            key={rule.id}
            className={cn(
              "relative rounded-xl border border-neutral-800 bg-[#141417]/80 backdrop-blur-sm p-4 flex flex-col justify-between shadow-lg transition-all duration-200 hover:border-neutral-700/80 hover:shadow-xl border-l-4",
              borderLeftColor,
              !rule.enabled && "opacity-75"
            )}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-neutral-100 truncate" title={rule.name}>
                  {rule.name}
                </h4>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wide uppercase border font-mono",
                      badgeColor
                    )}
                  >
                    {rule.severity}
                  </span>
                  <span className="text-[10px] text-neutral-500 font-medium">
                    in {rule.namespace === "all" ? "All Namespaces" : `"${rule.namespace}"`}
                  </span>
                </div>
              </div>

              {/* Status Toggle Switch */}
              <button
                onClick={() => toggleAlertRule(rule.id)}
                title={rule.enabled ? "Disable Rule" : "Enable Rule"}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] font-extrabold uppercase tracking-wider transition-all",
                  rule.enabled
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                    : "bg-neutral-800/80 text-neutral-500 border-neutral-700 hover:bg-neutral-800"
                )}
              >
                {rule.enabled ? (
                  <>
                    <Play className="h-3 w-3 fill-current shrink-0" />
                    <span>Active</span>
                  </>
                ) : (
                  <>
                    <Pause className="h-3 w-3 shrink-0" />
                    <span>Paused</span>
                  </>
                )}
              </button>
            </div>

            {/* Condition row */}
            <div className="flex items-center gap-2 rounded-lg bg-neutral-950/60 border border-neutral-900 px-3 py-2.5 mb-4 text-xs font-mono">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900 border border-neutral-800 text-neutral-400 shrink-0">
                <MetricIcon className="h-3.5 w-3.5" />
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

            {/* Footer row (Actions / Confirmations) */}
            <div className="flex items-center justify-between border-t border-neutral-800/80 pt-3 mt-auto shrink-0">
              <span className="text-[10px] text-neutral-500 font-mono">
                Updated {new Date(rule.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>

              <div className="flex items-center gap-2">
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-1.5 animate-in slide-in-from-right-1 duration-150">
                    <span className="text-[10px] text-red-400 font-semibold font-sans">Delete policy?</span>
                    <button
                      onClick={() => handleConfirmDelete(rule.id)}
                      className="rounded bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-bold text-red-400 hover:bg-red-500/30 transition-all"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="rounded bg-neutral-800 border border-neutral-700 px-2 py-0.5 text-[10px] font-semibold text-neutral-400 hover:bg-neutral-750 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => onEditRule(rule)}
                      className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 px-2.5 py-1 text-[11px] font-semibold text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 hover:border-neutral-700 transition-all"
                    >
                      <Edit2 className="h-3 w-3" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(rule.id)}
                      className="flex items-center gap-1 rounded-lg border border-transparent bg-transparent px-2.5 py-1 text-[11px] font-semibold text-red-500/80 hover:bg-red-500/10 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
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
