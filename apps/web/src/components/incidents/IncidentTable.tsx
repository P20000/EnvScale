import { Icon } from "../ui/Icon";
import { mdiAlertOctagon, mdiShieldCheck } from "@mdi/js";
import { IncidentSeverityCell, type Severity } from "./IncidentSeverityCell";
import { EmptyState } from "../ui/empty-state";

export interface IncidentItem {
  id: string;
  pod: string;
  namespace: string;
  cluster: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  time: string;
  rawTimestamp?: string;
  status: "TRIGGERED" | "RESOLVED";
}

interface IncidentTableProps {
  incidents: IncidentItem[];
  filteredIncidents: IncidentItem[];
  clusters: string[];
  severityFilter: string;
  setSeverityFilter: (val: string) => void;
  statusFilter: string;
  setStatusFilter: (val: string) => void;
  clusterFilter: string;
  setClusterFilter: (val: string) => void;
  formatPreciseTime: (iso?: string) => string;
}

export function IncidentTable({
  incidents,
  filteredIncidents,
  clusters,
  severityFilter,
  setSeverityFilter,
  statusFilter,
  setStatusFilter,
  clusterFilter,
  setClusterFilter,
  formatPreciseTime,
}: IncidentTableProps) {
  return (
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

      {/* Incident Table Container */}
      <div className="rounded-2xl border border-neutral-800 bg-surface flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="px-4 py-2 border-b border-neutral-800 text-[10px] font-bold tracking-wider uppercase text-neutral-400 flex items-center justify-between bg-background shrink-0 font-heading">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <span className="w-28 font-mono shrink-0">Incident ID</span>
            <span className="w-20 shrink-0">Severity</span>
            <span className="w-48 font-mono shrink-0">Target Resource</span>
            <span className="w-52 font-mono shrink-0">Context (NS • Cluster)</span>
            <span className="flex-1 truncate">Telemetry Context</span>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="w-36 text-right font-mono shrink-0">Time</span>
            <span className="w-20 text-center shrink-0">Status</span>
          </div>
        </div>

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
            {filteredIncidents.map((item) => {
              const timeStr = formatPreciseTime(item.rawTimestamp || item.time);
              return (
                <div
                  key={item.id}
                  className="py-1.5 px-4 flex items-center justify-between gap-4 hover:bg-neutral-900/60 transition-colors text-xs"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className="w-28 font-mono text-xs font-semibold text-neutral-200 shrink-0">{item.id}</span>
                    <div className="w-20 shrink-0">
                      <IncidentSeverityCell severity={item.severity as Severity} />
                    </div>
                    <span className="w-48 font-mono text-xs text-neutral-300 truncate block shrink-0">{item.pod}</span>
                    <span className="w-52 max-w-[210px] font-mono text-xs text-neutral-500 truncate block shrink-0">
                      ns/{item.namespace} • {item.cluster}
                    </span>
                    <span className="flex-1 text-xs text-neutral-300 truncate block min-w-0">{item.message}</span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="w-36 text-right font-mono text-xs text-neutral-200 shrink-0">
                      {timeStr}
                    </div>
                    <div className="w-20 text-center">
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
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
