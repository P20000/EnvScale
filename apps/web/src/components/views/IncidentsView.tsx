import { useState } from "react";
import { AlertTriangle, CheckCircle2, Filter, ShieldAlert, Server, Plus, Settings } from "lucide-react";
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

const initialIncidents: Incident[] = [
  {
    id: "INC-9045",
    pod: "payment-api-7b8f99-x2k4",
    namespace: "default",
    cluster: "minikube-prod",
    severity: "CRITICAL",
    message: "CrashLoopBackOff — Container exited with code 137 (OOMKilled)",
    time: "2 mins ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9044",
    pod: "ingress-nginx-controller-84fd",
    namespace: "ingress-nginx",
    cluster: "minikube-prod",
    severity: "WARNING",
    message: "High Latency Alert — P99 response time exceeded 450ms threshold",
    time: "8 mins ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9043",
    pod: "auth-service-7f8d-b2",
    namespace: "default",
    cluster: "staging-us-east",
    severity: "WARNING",
    message: "Frequent Restarts — Pod restarted 3 times in last 15 minutes",
    time: "15 mins ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9042",
    pod: "postgres-cluster-0",
    namespace: "database",
    cluster: "minikube-prod",
    severity: "CRITICAL",
    message: "Database IOPS Limit Exceeded — Disk read queue length > 12",
    time: "22 mins ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9040",
    pod: "redis-leader-0",
    namespace: "database",
    cluster: "minikube-prod",
    severity: "INFO",
    message: "Pod rescheduled on node minikube-worker-2",
    time: "30 mins ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9039",
    pod: "worker-node-exporter",
    namespace: "monitoring",
    cluster: "eks-production",
    severity: "CRITICAL",
    message: "Disk Pressure Alert — Root filesystem volume utilization at 92%",
    time: "45 mins ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9037",
    pod: "checkout-worker-99a1",
    namespace: "ecommerce",
    cluster: "minikube-prod",
    severity: "WARNING",
    message: "CPU Throttling Warning — Pod exceeded 80% CPU limit quota",
    time: "52 mins ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9036",
    pod: "vault-secrets-mgr-0",
    namespace: "security",
    cluster: "eks-production",
    severity: "INFO",
    message: "TLSCertificateAutoRenewed — Certificate renewed successfully",
    time: "1 hour ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9035",
    pod: "prometheus-server-7b4d",
    namespace: "monitoring",
    cluster: "staging-us-east",
    severity: "WARNING",
    message: "Scrape Target Down — Endpoint metrics-exporter unreachable",
    time: "1 hour ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9034",
    pod: "kafka-broker-2",
    namespace: "event-bus",
    cluster: "eks-production",
    severity: "CRITICAL",
    message: "UnderReplicatedPartitions — 4 partitions lagging behind leader",
    time: "2 hours ago",
    status: "TRIGGERED",
  },
  {
    id: "INC-9033",
    pod: "elasticsearch-datanode-1",
    namespace: "logging",
    cluster: "minikube-prod",
    severity: "WARNING",
    message: "High Memory Usage — JVM heap usage sustained above 85%",
    time: "2 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9032",
    pod: "rabbitmq-node-0",
    namespace: "messaging",
    cluster: "staging-us-east",
    severity: "INFO",
    message: "Queue Memory Alarm Cleared — High watermark reset to normal",
    time: "3 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9031",
    pod: "frontend-web-capsule-44",
    namespace: "default",
    cluster: "minikube-prod",
    severity: "WARNING",
    message: "ImagePullBackOff — Failed to pull image registry.internal/app:v2.4",
    time: "3 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9029",
    pod: "graphql-gateway-55f2",
    namespace: "api-layer",
    cluster: "eks-production",
    severity: "CRITICAL",
    message: "Upstream Timeout — 504 Gateway Timeout rate spiked by +18%",
    time: "4 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9028",
    pod: "k8s-streamer-go-daemon",
    namespace: "envscale-system",
    cluster: "minikube-prod",
    severity: "INFO",
    message: "SharedInformerFactory initialized — Watching PodInformer events",
    time: "5 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9027",
    pod: "cert-manager-controller",
    namespace: "kube-system",
    cluster: "staging-us-east",
    severity: "INFO",
    message: "ACME Challenge Verified — Issued wildcard certificate *.envscale.io",
    time: "6 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9025",
    pod: "chaos-mesh-daemon-x8",
    namespace: "chaos-testing",
    cluster: "minikube-prod",
    severity: "WARNING",
    message: "Chaos Fault Injected — Simulated 500ms network delay on payment-api",
    time: "7 hours ago",
    status: "RESOLVED",
  },
  {
    id: "INC-9021",
    pod: "metrics-server-8f92",
    namespace: "kube-system",
    cluster: "eks-production",
    severity: "INFO",
    message: "Metrics Scrape Succeeded — 48 node metrics aggregated",
    time: "8 hours ago",
    status: "RESOLVED",
  },
];

export function IncidentsView() {
  const clusters = useTopologyStore((s) => s.clusters);
  const alertRules = useAlertStore((s) => s.alertRules);
  const setSelectedAlertRule = useAlertStore((s) => s.setSelectedAlertRule);

  const [activeSubTab, setActiveSubTab] = useState<"log" | "rules">("log");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [clusterFilter, setClusterFilter] = useState<string>("ALL");

  // Apply combined multi-filters
  const filteredIncidents = initialIncidents.filter((item) => {
    if (severityFilter !== "ALL" && item.severity !== severityFilter) return false;
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (clusterFilter !== "ALL" && item.cluster !== clusterFilter) return false;
    return true;
  });

  const triggeredCount = filteredIncidents.filter((i) => i.status === "TRIGGERED").length;

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
              Showing {filteredIncidents.length} of {initialIncidents.length} Incidents
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
                <div className="text-xl font-bold text-neutral-100 font-mono">98.4%</div>
                <div className="text-[11px] text-neutral-400">Cluster Availability</div>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-4 flex items-center gap-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20 shrink-0">
                <ShieldAlert className="h-4 w-4" />
              </div>
              <div>
                <div className="text-xl font-bold text-neutral-100 font-mono">14m</div>
                <div className="text-[11px] text-neutral-400">Mean Time to Resolve</div>
              </div>
            </div>
          </div>

          {/* Incident List Container with Constrained Height & Internal Scrollbar ONLY */}
          <div className="rounded-2xl border border-neutral-800 bg-[#141417] shadow-xl flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Fixed Header (shrink-0) */}
            <div className="px-6 py-3.5 border-b border-neutral-800 font-semibold text-xs text-neutral-300 flex items-center justify-between bg-neutral-900/50 shrink-0">
              <span>Incident Audit Log</span>
              <span className="font-mono text-[10px] text-neutral-400">Live WebSockets</span>
            </div>

            {/* Scrollable list area ONLY */}
            {filteredIncidents.length === 0 ? (
              <div className="p-12 text-center text-xs text-neutral-400 font-mono flex-1 flex items-center justify-center">
                No incidents found matching the selected filter criteria.
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
                        Target Pod: <span className="text-neutral-200">{item.pod}</span>
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
