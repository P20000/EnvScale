import { useState, useMemo } from "react";
import Icon from "@mdi/react";
import {
  mdiAlertCircle,
  mdiAlert,
  mdiInformation,
  mdiCheckCircle,
  mdiServer,
  mdiPlus,
  mdiCog,
  mdiShieldCheck,
  mdiAlertOctagon,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useAlertStore } from "../../store/useAlertStore";
import { AlertRuleList } from "../alerts/AlertRuleList";
import { AlertRuleModal } from "../alerts/AlertRuleModal";
import type { AlertRule } from "../../types/alerts";
import { EmptyState } from "../ui/empty-state";

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

type Severity = "critical" | "warning" | "minor" | "info" | "CRITICAL" | "WARNING" | "INFO";

export function IncidentSeverityCell({ severity }: { severity: Severity }) {
  const sevKey = severity.toLowerCase() as "critical" | "warning" | "minor" | "info";
  const configs = {
    critical: {
      path: mdiAlertCircle,
      bg: "bg-red-500/5",
      text: "text-red-400",
      border: "border-red-500/20",
      label: "Critical",
    },
    warning: {
      path: mdiAlert,
      bg: "bg-amber-500/5",
      text: "text-amber-400",
      border: "border-amber-500/20",
      label: "High",
    },
    minor: {
      path: mdiInformation,
      bg: "bg-yellow-500/5",
      text: "text-yellow-400",
      border: "border-yellow-500/20",
      label: "Minor",
    },
    info: {
      path: mdiCheckCircle,
      bg: "bg-blue-500/5",
      text: "text-blue-400",
      border: "border-blue-500/20",
      label: "Info",
    },
  };

  const current = configs[sevKey] || configs.info;

  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium border rounded-full ${current.bg} ${current.text} ${current.border}`}>
      <Icon path={current.path} size={0.65} />
      <span>{current.label}</span>
    </div>
  );
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
    <div className="h-full w-full flex flex-col p-6 space-y-4 bg-background overflow-hidden">
      {/* Top Header & Navigation Bar */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-neutral-100 font-heading">Incidents & Alert Policies</h1>
          <p className="text-xs text-neutral-400">
            Real-time incident log monitoring and custom metric threshold configuration.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface p-1 rounded-md border border-neutral-800">
            <button
              onClick={() => setActiveSubTab("log")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeSubTab === "log"
                  ? "bg-blue-500 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Incident History ({filteredIncidents.length})
            </button>
            <button
              onClick={() => setActiveSubTab("rules")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeSubTab === "rules"
                  ? "bg-blue-500 text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Alert Rules ({alertRules.length})
            </button>
          </div>

          {activeSubTab === "rules" && (
            <button
              onClick={handleCreateRule}
              className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600 transition-colors"
            >
              <Icon path={mdiPlus} size={0.65} />
              <span>Create Alert Rule</span>
            </button>
          )}
        </div>
      </div>

      {activeSubTab === "log" ? (
        <>
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-surface p-3.5 rounded-2xl border border-neutral-800 shrink-0">
            <div className="flex items-center gap-2">
              <Icon path={mdiAlertOctagon} size={0.83} className="text-blue-400" />
              <span className="text-xs font-semibold text-neutral-200 font-heading">Incident Filters</span>
              <span className="text-xs font-mono text-neutral-400">
                (Showing {filteredIncidents.length} of {incidents.length} Incidents)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Severity Filter */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-neutral-400 font-medium">Severity:</span>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="rounded-sm bg-background border border-neutral-800 px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
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
                  className="rounded-sm bg-background border border-neutral-800 px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer"
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
                  className="rounded-sm bg-background border border-neutral-800 px-3 py-1.5 text-xs font-mono text-neutral-200 focus:outline-none focus:border-blue-500 cursor-pointer max-w-[200px] truncate"
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
                  className="rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 px-2.5 py-1.5 text-xs font-medium transition-colors"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 shrink-0">
            <div className="rounded-2xl border border-neutral-800 bg-surface p-3.5 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                <Icon path={mdiAlertCircle} size={0.83} />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-100 font-mono">{triggeredCount}</div>
                <div className="text-[11px] text-neutral-400">Triggered Incidents</div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-surface p-3.5 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                <Icon path={mdiCheckCircle} size={0.83} />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-100 font-mono">{availabilityPercentage}</div>
                <div className="text-[11px] text-neutral-400">Cluster Availability</div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-surface p-4 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
                <Icon path={mdiShieldCheck} size={0.83} />
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
          <div className="rounded-2xl border border-neutral-800 bg-surface flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Fixed Header */}
            <div className="px-6 py-3.5 border-b border-neutral-800 font-semibold text-xs text-neutral-300 flex items-center justify-between bg-background shrink-0 font-heading">
              <span>Incident Audit Log</span>
              <span className="font-mono text-[10px] text-neutral-400">Live Telemetry</span>
            </div>

            {/* Scrollable list area */}
            {filteredIncidents.length === 0 ? (
              <EmptyState
                className="flex-1"
                icon={<Icon path={mdiShieldCheck} size={1.2} className="text-emerald-400" />}
                title={incidents.length === 0 ? "No Active Incidents Detected" : "No Matching Incidents"}
                description={
                  incidents.length === 0
                    ? "All monitored pods and workload resources in the cluster are healthy and operating normally."
                    : "No incidents match the current filters. Adjust the filters to see more results."
                }
                action={
                  incidents.length !== 0 &&
                  (severityFilter !== "ALL" || statusFilter !== "ALL" || clusterFilter !== "ALL")
                    ? {
                        label: "Reset filters",
                        onClick: () => {
                          setSeverityFilter("ALL");
                          setStatusFilter("ALL");
                          setClusterFilter("ALL");
                        },
                      }
                    : undefined
                }
              />
            ) : (
              <div className="divide-y divide-neutral-800 flex-1 min-h-0 overflow-y-auto">
                {filteredIncidents.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 flex items-center justify-between hover:bg-neutral-900 transition-colors"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-neutral-200">{item.id}</span>
                        <IncidentSeverityCell severity={item.severity} />
                        <span className="text-xs text-neutral-400 font-mono">[{item.namespace}]</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-neutral-400 bg-background px-2 py-0.5 rounded-sm border border-neutral-800 max-w-[160px] truncate">
                          <Icon path={mdiServer} size={0.55} className="text-neutral-400 shrink-0" />
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
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
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
            <Icon path={mdiCog} size={0.65} className="text-neutral-500" />
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
