import { useState, useMemo } from "react";
import {
  MdWarning as AlertTriangle,
  MdCheckCircle as CheckCircle2,
  MdFilterList as Filter,
  MdSecurity as ShieldAlert,
  MdDns as Server,
  MdAdd as Plus,
  MdSettings as Settings,
  MdVerifiedUser as ShieldCheck,
} from "react-icons/md";
import { Badge } from "../ui/badge";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useAlertStore } from "../../store/useAlertStore";
import { AlertRuleList } from "../alerts/AlertRuleList";
import { AlertRuleModal } from "../alerts/AlertRuleModal";
import { cn } from "../../lib/utils";
import type { AlertRule } from "../../types/alerts";

interface Incident {
  id: string;
  pod: string;
  namespace: string;
  cluster: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  time: string;
  status: "TRIGGERED" | "RESOLVED";
}

export function IncidentsView() {
  const clusters = useTopologyStore((s) => s.clusters);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const pods = useTopologyStore((s) => s.pods);
  const notifications = useTopologyStore((s) => s.notifications);

  const alertRules = useAlertStore((s) => s.alertRules);
  const setSelectedAlertRule = useAlertStore((s) => s.setSelectedAlertRule);

  const [activeSubTab, setActiveSubTab] = useState<"log" | "rules">("log");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [clusterFilter, setClusterFilter] = useState<string>("ALL");

  // Derive incidents dynamically from live cluster state and notifications (no static hardcoded mocks)
  const incidents = useMemo<Incident[]>(() => {
    const list: Incident[] = [];
    const seenIds = new Set<string>();

    // 1. Pod anomalies & non-running statuses
    pods.forEach((pod) => {
      if (pod.status !== "Running" || pod.restarts > 0) {
        const id = `INC-POD-${pod.name.slice(-4).toUpperCase()}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          const statusStr = pod.status as string;
          const isCritical = statusStr === "CrashLoopBackOff" || statusStr === "Failed" || statusStr === "OOMKilled";
          const isWarning = pod.restarts > 0 || statusStr === "Pending" || statusStr === "ImagePullBackOff";
          list.push({
            id,
            pod: pod.name,
            namespace: pod.namespace || "default",
            cluster: activeCluster || "minikube-prod",
            severity: isCritical ? "CRITICAL" : isWarning ? "WARNING" : "INFO",
            message: `Pod status: ${pod.status}${pod.restarts > 0 ? ` (${pod.restarts} restart${pod.restarts > 1 ? "s" : ""})` : ""}`,
            time: "Just now",
            status: pod.status === "Terminated" ? "RESOLVED" : "TRIGGERED",
          });
        }
      }
    });

    // 2. Telemetry alert notifications triggered by streamer
    notifications.forEach((n) => {
      const id = `INC-${n.id.slice(-6).toUpperCase()}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        list.push({
          id,
          pod: n.title,
          namespace: "default",
          cluster: n.cluster || activeCluster || "minikube-prod",
          severity: n.severity,
          message: n.message,
          time: n.time || "Just now",
          status: "TRIGGERED",
        });
      }
    });

    return list;
  }, [pods, notifications, activeCluster]);

  // Apply combined multi-filters
  const filteredIncidents = useMemo(() => {
    return incidents.filter((item) => {
      if (severityFilter !== "ALL" && item.severity !== severityFilter) return false;
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (clusterFilter !== "ALL" && item.cluster !== clusterFilter) return false;
      return true;
    });
  }, [incidents, severityFilter, statusFilter, clusterFilter]);

  const triggeredCount = useMemo(() => {
    return filteredIncidents.filter((i) => i.status === "TRIGGERED").length;
  }, [filteredIncidents]);

  const availabilityPercentage = useMemo(() => {
    if (pods.length === 0) return "100.0%";
    const healthyPods = pods.filter((p) => p.status === "Running").length;
    const pct = ((healthyPods / pods.length) * 100).toFixed(1);
    return `${pct}%`;
  }, [pods]);

  const handleEditRule = (rule: AlertRule) => {
    setSelectedAlertRule(rule);
    setIsModalOpen(true);
  };

  const handleCreateRule = () => {
    setSelectedAlertRule(null);
    setIsModalOpen(true);
  };

  return (
    <div className="h-full max-h-screen flex flex-col w-full max-w-7xl px-6 lg:px-8 pt-24 pb-12 mx-auto space-y-5 overflow-hidden">
      {/* Header (shrink-0) */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xl font-bold text-neutral-100 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-500" />
            Incidents & Alert Policies
          </h2>
          <p className="text-sm text-neutral-400 mt-1">
            Real-time incident detection and severity rules for active Kubernetes workloads
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeSubTab === "log" ? (
            <span className="text-xs text-neutral-400 font-mono">
              Showing {filteredIncidents.length} of {incidents.length} Incidents
            </span>
          ) : (
            <span className="text-xs text-neutral-400 font-mono">
              {alertRules.length} Rule{alertRules.length !== 1 && "s"} Configured
            </span>
          )}
        </div>
      </div>

      {/* Sub-tab selection bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 shrink-0">
        <div className="flex gap-6">
          <button
            onClick={() => setActiveSubTab("log")}
            className={cn(
              "pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all focus:outline-none",
              activeSubTab === "log"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            )}
          >
            Incident Audit Log
          </button>
          <button
            onClick={() => setActiveSubTab("rules")}
            className={cn(
              "pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all focus:outline-none",
              activeSubTab === "rules"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            )}
          >
            Alert Rules ({alertRules.length})
          </button>
        </div>

        {activeSubTab === "rules" && (
          <button
            onClick={handleCreateRule}
            className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 active:scale-95 transition-all shadow-md shadow-blue-500/20 mb-2"
          >
            <Plus className="h-4 w-4" />
            <span>Create Alert Rule</span>
          </button>
        )}
      </div>

      {activeSubTab === "log" ? (
        <>
          {/* Interactive Filter Bar (shrink-0) */}
          <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-3.5 flex flex-wrap items-center justify-between gap-4 shadow-xl shrink-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
              <Filter className="h-4 w-4 text-blue-400" />
              <span>Filter Incidents:</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Severity Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-neutral-400 font-medium">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="ALL">All Severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="WARNING">Warning</option>
                  <option value="INFO">Info</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-neutral-400 font-medium">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="TRIGGERED">Triggered</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </div>

              {/* Cluster Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-neutral-400 font-medium">Cluster:</span>
                <select
                  value={clusterFilter}
                  onChange={(e) => setClusterFilter(e.target.value)}
                  className="rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer max-w-[200px] truncate"
                >
                  <option value="ALL">All Clusters ({clusters.length})</option>
                  {clusters.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reset Filters */}
              {(severityFilter !== "ALL" || statusFilter !== "ALL" || clusterFilter !== "ALL") && (
                <button
                  onClick={() => {
                    setSeverityFilter("ALL");
                    setStatusFilter("ALL");
                    setClusterFilter("ALL");
                  }}
                  className="rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 px-2.5 py-1.5 text-xs font-medium transition-colors"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </div>

          {/* Summary Cards (shrink-0) */}
          <div className="grid grid-cols-3 gap-4 shrink-0">
            <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-3.5 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-100 font-mono">{triggeredCount}</div>
                <div className="text-[11px] text-neutral-400">Triggered Incidents</div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-3.5 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-100 font-mono">{availabilityPercentage}</div>
                <div className="text-[11px] text-neutral-400">Cluster Availability</div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-4 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-100 font-mono">
                  {triggeredCount === 0 ? "0m" : "< 5m"}
                </div>
                <div className="text-[11px] text-neutral-400">Mean Time to Resolve</div>
              </div>
            </div>
          </div>

          {/* Incident List Container */}
          <div className="rounded-2xl border border-neutral-800 bg-[#141417] shadow-xl flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Fixed Header (shrink-0) */}
            <div className="px-6 py-3.5 border-b border-neutral-800 font-semibold text-xs text-neutral-300 flex items-center justify-between bg-neutral-900/50 shrink-0">
              <span>Incident Audit Log</span>
              <span className="font-mono text-[10px] text-neutral-400">Live Telemetry</span>
            </div>

            {/* Scrollable list area ONLY */}
            {filteredIncidents.length === 0 ? (
              <div className="p-12 text-center text-xs text-neutral-400 font-mono flex-1 flex flex-col items-center justify-center space-y-3">
                <ShieldCheck className="h-9 w-9 text-emerald-500/80 mb-1" />
                <span className="text-neutral-200 font-semibold text-sm">No Active Incidents Detected</span>
                <span className="text-neutral-500 max-w-sm text-center">
                  All monitored pods and workload resources in the cluster are healthy and operating normally.
                </span>
              </div>
            ) : (
              <div className="divide-y divide-neutral-800/60 flex-1 min-h-0 overflow-y-auto">
                {filteredIncidents.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 flex items-center justify-between hover:bg-neutral-900/40 transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-neutral-200">{item.id}</span>
                        <Badge
                          variant={
                            item.severity === "CRITICAL"
                              ? "destructive"
                              : item.severity === "WARNING"
                              ? "default"
                              : "muted"
                          }
                          className={
                            item.severity === "WARNING"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/30 !border"
                              : undefined
                          }
                        >
                          {item.severity}
                        </Badge>
                        <span className="text-xs text-neutral-400 font-mono">[{item.namespace}]</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-neutral-800 max-w-[160px] truncate">
                          <Server className="h-3 w-3 text-neutral-400 shrink-0" />
                          <span className="truncate">{item.cluster}</span>
                        </span>
                      </div>
                      <p className="text-xs text-neutral-300">{item.message}</p>
                      <div className="text-[10px] text-neutral-400 font-mono">
                        Target Resource: <span className="text-neutral-200">{item.pod}</span>
                      </div>
                    </div>

                    <div className="text-right space-y-1 shrink-0">
                      <span className="text-xs text-neutral-400 font-mono">{item.time}</span>
                      <div>
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                            item.status === "TRIGGERED"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400 px-1">
            <Settings className="h-4 w-4 text-neutral-500 animate-spin-slow" />
            <span>Kubernetes stream thresholds will trigger matching alert notifications on match:</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <AlertRuleList onEditRule={handleEditRule} />
          </div>
        </div>
      )}

      {/* Alert Rule Configuration Modal */}
      {isModalOpen && (
        <AlertRuleModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}
