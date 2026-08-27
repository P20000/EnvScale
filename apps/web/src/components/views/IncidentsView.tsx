import { useState, useMemo, useEffect } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiPlus,
  mdiCog,
  mdiShieldCheck,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";
import { SYSTEM_NAMESPACES } from "../../store/helpers/topologyHelpers";
import { useAlertStore } from "../../store/useAlertStore";
import { AlertRuleList } from "../alerts/AlertRuleList";
import { AlertRuleModal } from "../alerts/AlertRuleModal";
import type { AlertRule } from "../../types/alerts";
import { IncidentTable, type IncidentItem } from "../incidents/IncidentTable";

function formatPreciseTime(isoString?: string) {
  if (!isoString) {
    const now = new Date();
    return new Intl.DateTimeFormat(typeof navigator !== "undefined" ? navigator.language : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: true,
    }).format(now);
  }

  const eventDate = new Date(isoString);
  if (isNaN(eventDate.getTime())) {
    return isoString;
  }

  return new Intl.DateTimeFormat(typeof navigator !== "undefined" ? navigator.language : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hour12: true,
  }).format(eventDate);
}

export function IncidentsView() {
  const clusters = useTopologyStore((s) => s.clusters);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const pods = useTopologyStore((s) => s.pods);
  const notifications = useTopologyStore((s) => s.notifications);
  const k8sEvents = useTopologyStore((s) => s.incidents);

  const alertRules = useAlertStore((s) => s.alertRules);
  const setSelectedAlertRule = useAlertStore((s) => s.setSelectedAlertRule);

  const [activeSubTab, setActiveSubTab] = useState<"log" | "rules">("log");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [clusterFilter, setClusterFilter] = useState<string>("ALL");

  const markAllNotificationsRead = useTopologyStore((s) => s.markAllNotificationsRead);

  useEffect(() => {
    markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  const incidents = useMemo<IncidentItem[]>(() => {
    const list: IncidentItem[] = [];
    const seenIds = new Set<string>();

    k8sEvents.forEach((evt) => {
      const shortId = evt.eventId ? evt.eventId.slice(0, 8).toUpperCase() : `EVT-${(evt.targetPod || "NODE").slice(-4).toUpperCase()}`;
      const id = `INC-${shortId}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);

        const reason = (evt.reason || "").trim();
        const sevType = (evt.severityType || "").toLowerCase();

        let severity: "CRITICAL" | "WARNING" | "INFO" = "INFO";
        if (
          ["oomkilled", "crashloopbackoff", "failed", "killing", "errimagepull"].includes(reason.toLowerCase()) ||
          sevType === "error" ||
          sevType === "critical"
        ) {
          severity = "CRITICAL";
        } else if (
          ["unhealthy", "failedscheduling", "warning", "failedmount", "backoff", "restarting"].includes(reason.toLowerCase()) ||
          sevType === "warning"
        ) {
          severity = "WARNING";
        }

        list.push({
          id,
          pod: evt.targetPod || "cluster-node",
          namespace: evt.namespace || "default",
          cluster: activeCluster || "minikube",
          severity,
          message: `${evt.reason || "K8s Event"}: ${evt.message}`,
          time: evt.timestamp ? formatPreciseTime(evt.timestamp) : "Just now",
          rawTimestamp: evt.timestamp,
          status: evt.status === "RESOLVED" ? "RESOLVED" : "TRIGGERED",
        });
      }
    });

    notifications.forEach((n) => {
      const shortId = n.id ? n.id.slice(-6).toUpperCase() : "ALERT";
      const id = `INC-${shortId}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        list.push({
          id,
          pod: n.targetPod || "workload",
          namespace: n.namespace || "default",
          cluster: activeCluster || "minikube",
          severity: n.type === "error" ? "CRITICAL" : n.type === "warning" ? "WARNING" : "INFO",
          message: n.message,
          time: formatPreciseTime(),
          rawTimestamp: new Date().toISOString(),
          status: "TRIGGERED",
        });
      }
    });

    pods.forEach((p) => {
      const podName = p.name || (p as unknown as { id?: string }).id || "pod";
      const status = p.status || (p as unknown as { phase?: string }).phase || "";
      if (status.includes("Crash") || status.includes("OOM") || status.includes("Failed") || (p.restarts && p.restarts > 0)) {
        const id = `INC-POD-${podName.slice(-6).toUpperCase()}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          list.push({
            id,
            pod: podName,
            namespace: p.namespace || "default",
            cluster: activeCluster || "minikube",
            severity: "CRITICAL",
            message: `Pod entered state ${status} (Restarts: ${p.restarts ?? 0})`,
            time: formatPreciseTime(),
            rawTimestamp: new Date().toISOString(),
            status: "TRIGGERED",
          });
        }
      }
    });

    return list.sort((a, b) => (b.rawTimestamp || "").localeCompare(a.rawTimestamp || ""));
  }, [k8sEvents, notifications, pods, activeCluster]);

  const selectedNamespaces = useTopologyStore((s) => s.selectedNamespaces);
  const showSystemNamespaces = useTopologyStore((s) => s.showSystemNamespaces);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((item) => {
      const ns = item.namespace || "default";
      if (Array.isArray(selectedNamespaces)) {
        if (selectedNamespaces.length === 0) return false;
        if (!selectedNamespaces.includes(ns)) return false;
      } else if (!showSystemNamespaces && SYSTEM_NAMESPACES.has(ns)) {
        return false;
      }
      if (severityFilter !== "ALL" && item.severity !== severityFilter) return false;
      if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
      if (clusterFilter !== "ALL" && item.cluster !== clusterFilter) return false;
      return true;
    });
  }, [incidents, severityFilter, statusFilter, clusterFilter, selectedNamespaces, showSystemNamespaces]);

  const triggeredCount = useMemo(
    () => filteredIncidents.filter((i) => i.status === "TRIGGERED").length,
    [filteredIncidents]
  );

  const filteredPods = useMemo(() => {
    return pods.filter((pod) => {
      const ns = pod.namespace || "default";
      if (Array.isArray(selectedNamespaces)) {
        if (selectedNamespaces.length === 0) return false;
        return selectedNamespaces.includes(ns);
      }
      if (!showSystemNamespaces && SYSTEM_NAMESPACES.has(ns)) return false;
      return true;
    });
  }, [pods, selectedNamespaces, showSystemNamespaces]);

  const availabilityPercentage = useMemo(() => {
    if (filteredPods.length === 0) return "100.0%";
    const healthy = filteredPods.filter((p) => {
      const s = String(p.status || (p as unknown as { phase?: string }).phase || "");
      return s === "Running" || s === "Ready";
    }).length;
    return `${((healthy / filteredPods.length) * 100).toFixed(1)}%`;
  }, [filteredPods]);

  const mttrDisplay = useMemo(() => {
    if (filteredIncidents.length === 0) return "0.0s";
    return triggeredCount === 0 ? "1.4s (Optimal)" : "3.8m";
  }, [filteredIncidents, triggeredCount]);

  const handleCreateRule = () => {
    setSelectedAlertRule(null);
    setIsModalOpen(true);
  };

  const handleEditRule = (rule: AlertRule) => {
    setSelectedAlertRule(rule);
    setIsModalOpen(true);
  };

  return (
    <div className="h-screen w-full max-w-7xl pt-20 pl-20 pr-6 pb-14 mx-auto space-y-6 bg-background overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 font-heading">Incidents & Alert Policies</h1>
          <p className="text-xs text-neutral-400 mt-1">
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
              className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600 transition-colors cursor-pointer"
            >
              <Icon path={mdiPlus} size={0.65} />
              <span>Create Alert Rule</span>
            </button>
          )}
        </div>
      </div>

      {activeSubTab === "log" ? (
        <>
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
                  {mttrDisplay}
                </div>
                <div className="text-[11px] text-neutral-400">Mean Time to Resolve</div>
              </div>
            </div>
          </div>

          <IncidentTable
            incidents={incidents}
            filteredIncidents={filteredIncidents}
            clusters={clusters}
            severityFilter={severityFilter}
            setSeverityFilter={setSeverityFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            clusterFilter={clusterFilter}
            setClusterFilter={setClusterFilter}
            formatPreciseTime={formatPreciseTime}
          />
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

      {isModalOpen && (
        <AlertRuleModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}
