import { Cpu, HardDrive, RefreshCw, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";
import type { AlertRule, AlertMetric, AlertOperator, AlertSeverity } from "../../types/alerts";
import { cn } from "../../lib/utils";

interface AlertRuleBuilderProps {
  rule: Omit<AlertRule, "id" | "createdAt" | "updatedAt">;
  onChange: (fields: Partial<Omit<AlertRule, "id" | "createdAt" | "updatedAt">>) => void;
  errors: Record<string, string>;
}

export function AlertRuleBuilder({ rule, onChange, errors }: AlertRuleBuilderProps) {
  const pods = useTopologyStore((s) => s.pods);

  // Extract namespaces from current pods
  const podsNamespaces = Array.from(new Set(pods.map((p) => p.namespace).filter(Boolean))) as string[];
  const availableNamespaces = podsNamespaces.length > 0
    ? podsNamespaces
    : ["default", "kube-system", "monitoring", "database"];

  const metrics: { id: AlertMetric; label: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
    {
      id: "cpu",
      label: "CPU Usage",
      icon: Cpu,
      desc: "Monitor pod CPU consumption against limits",
    },
    {
      id: "memory",
      label: "Memory Usage",
      icon: HardDrive,
      desc: "Monitor pod memory pressure and OOM alerts",
    },
    {
      id: "pod_crash",
      label: "Pod Crash / Restart",
      icon: RefreshCw,
      desc: "Monitor container termination and restarts",
    },
  ];

  const operators: { value: AlertOperator; label: string }[] = [
    { value: "greater_than", label: "is greater than" },
    { value: "less_than", label: "is less than" },
    { value: "greater_than_or_equal", label: "is greater than or equal to" },
    { value: "less_than_or_equal", label: "is less than or equal to" },
  ];

  const durations = [
    "Immediately",
    "1 minute",
    "5 minutes",
    "10 minutes",
    "15 minutes",
    "30 minutes",
  ];

  const severities: { id: AlertSeverity; label: string; icon: React.ComponentType<{ className?: string }>; activeColor: string; bg: string }[] = [
    {
      id: "info",
      label: "INFO",
      icon: Info,
      activeColor: "border-blue-500/50 text-blue-400 bg-blue-500/10",
      bg: "hover:bg-blue-500/5 hover:border-blue-500/20",
    },
    {
      id: "warning",
      label: "WARNING",
      icon: AlertTriangle,
      activeColor: "border-amber-500/50 text-amber-400 bg-amber-500/10",
      bg: "hover:bg-amber-500/5 hover:border-amber-500/20",
    },
    {
      id: "critical",
      label: "CRITICAL",
      icon: AlertCircle,
      activeColor: "border-red-500/50 text-red-400 bg-red-500/10",
      bg: "hover:bg-red-500/5 hover:border-red-500/20",
    },
  ];

  const handleMetricSelect = (metric: AlertMetric) => {
    // Reset threshold to sensible defaults when switching metrics
    const defaultThreshold = metric === "pod_crash" ? 3 : 80;
    onChange({ metric, threshold: defaultThreshold });
  };

  return (
    <div className="space-y-5">
      {/* Rule Name */}
      <div>
        <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
          Rule Name
        </label>
        <input
          type="text"
          placeholder="e.g. backend-high-cpu-alert"
          value={rule.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={cn(
            "w-full rounded-lg border bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none transition-all",
            errors.name
              ? "border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500"
              : "border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          )}
        />
        {errors.name && (
          <span className="text-[10px] text-red-400 font-medium mt-1 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {errors.name}
          </span>
        )}
      </div>

      {/* Metric Cards */}
      <div>
        <label className="block text-xs font-semibold text-neutral-300 mb-2 uppercase tracking-wider">
          Select Alert Metric
        </label>
        <div className="grid grid-cols-3 gap-3">
          {metrics.map((m) => {
            const Icon = m.icon;
            const isSelected = rule.metric === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleMetricSelect(m.id)}
                className={cn(
                  "flex flex-col items-start text-left p-3.5 rounded-xl border transition-all duration-200 focus:outline-none",
                  isSelected
                    ? "bg-blue-500/10 border-blue-500 text-blue-400 shadow-md shadow-blue-500/5"
                    : "bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                )}
              >
                <div
                  className={cn(
                    "p-1.5 rounded-lg border mb-3 shrink-0",
                    isSelected ? "bg-blue-500/20 border-blue-500/30 text-blue-400" : "bg-neutral-950 border-neutral-800 text-neutral-400"
                  )}
                >
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <span className="text-xs font-bold text-neutral-200 mb-1">{m.label}</span>
                <span className="text-[10px] text-neutral-500 leading-tight">{m.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conditions row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Operator */}
        <div>
          <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
            Operator
          </label>
          <select
            value={rule.operator}
            onChange={(e) => onChange({ operator: e.target.value as AlertOperator })}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer font-mono"
          >
            {operators.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </div>

        {/* Threshold */}
        <div>
          <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
            Threshold Value
          </label>
          <div className="relative">
            <input
              type="number"
              placeholder={rule.metric === "pod_crash" ? "3" : "80"}
              value={isNaN(rule.threshold) ? "" : rule.threshold}
              onChange={(e) => onChange({ threshold: parseFloat(e.target.value) })}
              className={cn(
                "w-full rounded-lg border bg-neutral-900 pl-3.5 pr-12 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none transition-all font-mono",
                errors.threshold
                  ? "border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                  : "border-neutral-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              )}
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-xs font-semibold text-neutral-500 font-mono">
              {rule.metric === "pod_crash" ? "restarts" : "%"}
            </div>
          </div>
          {errors.threshold && (
            <span className="text-[10px] text-red-400 font-medium mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {errors.threshold}
            </span>
          )}
        </div>

        {/* Duration */}
        <div>
          <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
            For Duration
          </label>
          <select
            value={rule.duration}
            onChange={(e) => onChange({ duration: e.target.value })}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer"
          >
            {durations.map((dur) => (
              <option key={dur} value={dur}>
                {dur}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Severity Selector */}
      <div>
        <label className="block text-xs font-semibold text-neutral-300 mb-2 uppercase tracking-wider">
          Severity Level
        </label>
        <div className="grid grid-cols-3 gap-3">
          {severities.map((sev) => {
            const Icon = sev.icon;
            const isSelected = rule.severity === sev.id;
            return (
              <button
                key={sev.id}
                type="button"
                onClick={() => onChange({ severity: sev.id })}
                className={cn(
                  "flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-semibold tracking-wide transition-all duration-200 focus:outline-none",
                  isSelected ? sev.activeColor : cn("bg-neutral-900 border-neutral-800 text-neutral-400", sev.bg)
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{sev.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scope / Namespace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        <div>
          <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
            Scope Scopes
          </label>
          <select
            value={rule.namespace === "all" ? "all" : "specific"}
            onChange={(e) => {
              if (e.target.value === "all") {
                onChange({ namespace: "all" });
              } else {
                onChange({ namespace: availableNamespaces[0] || "default" });
              }
            }}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer"
          >
            <option value="all">All Namespaces</option>
            <option value="specific">Specific Namespace</option>
          </select>
        </div>

        {rule.namespace !== "all" && (
          <div>
            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 uppercase tracking-wider">
              Select Namespace
            </label>
            <select
              value={rule.namespace}
              onChange={(e) => onChange({ namespace: e.target.value })}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all cursor-pointer font-mono"
            >
              {availableNamespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Enabled / Disabled status */}
      <div className="flex items-center justify-between p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/40">
        <div>
          <h4 className="text-xs font-semibold text-neutral-200">Rule Active Status</h4>
          <p className="text-[10px] text-neutral-500 mt-0.5">Toggle whether this alert rule evaluates incoming streams</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ enabled: !rule.enabled })}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-blue-500/50",
            rule.enabled ? "bg-blue-500" : "bg-neutral-800"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
              rule.enabled ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>
    </div>
  );
}
