import type { LogLevel, StreamHealthSummary } from "../../types/logs";

const LOG_LEVELS: Array<LogLevel | "ALL"> = ["ALL", "ERROR", "WARN", "INFO", "DEBUG"];

interface LogsToolbarProps {
  selectedNs: string;
  availableNamespaces: string[];
  onSelectNs: (ns: string) => void;
  selectedResourceId: string;
  onSelectResource: (id: string) => void;
  podsInNs: Array<{ name: string; status?: string }>;
  depsInNs: Array<{ name: string }>;
  statefulInNs: Array<{ name: string }>;
  daemonInNs: Array<{ name: string }>;
  jobsInNs: Array<{ name: string }>;
  servicesInNs: Array<{ name: string }>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedLevel: LogLevel | "ALL";
  onSelectLevel: (level: LogLevel | "ALL") => void;
  levelCounts: Record<string, number>;
  healthSummary: StreamHealthSummary;
  status: string;
  onToggleDiagnostics: () => void;
  isTailing: boolean;
  onToggleTailing: () => void;
  onClearLogs: () => void;
  onCopyLogs: () => void;
  copied: boolean;
  onDownloadLogs: () => void;
}

export function LogsToolbar({
  selectedNs,
  availableNamespaces,
  onSelectNs,
  selectedResourceId,
  onSelectResource,
  podsInNs,
  depsInNs,
  statefulInNs,
  daemonInNs,
  jobsInNs,
  servicesInNs,
  searchQuery,
  onSearchChange,
  selectedLevel,
  onSelectLevel,
  levelCounts,
  healthSummary,
  status,
  onToggleDiagnostics,
  isTailing,
  onToggleTailing,
  onClearLogs,
  onCopyLogs,
  copied,
  onDownloadLogs,
}: LogsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#30343B] bg-[#191B20] px-3.5 py-2 shrink-0">
      {/* Left: Target Selectors & Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Namespace Dropdown */}
        <div className="flex items-center gap-1.5 text-xs text-[#92959D]">
          <span>Namespace:</span>
          <select
            value={selectedNs}
            onChange={(e) => onSelectNs(e.target.value)}
            className="rounded-md border border-[#30343B] bg-[#111318] px-2 py-1 text-xs font-mono text-[#E6E1E5] outline-none focus:border-[#5C616B] transition-colors cursor-pointer"
          >
            {availableNamespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns === "all" ? "All Namespaces (Cluster-Wide)" : ns}
              </option>
            ))}
          </select>
        </div>

        {/* Universal Resource Selector (All Resources, Pods, Deployments, StatefulSets, Jobs, Services) */}
        <div className="flex items-center gap-1.5 text-xs text-[#92959D]">
          <span>Resource:</span>
          <select
            value={selectedResourceId}
            onChange={(e) => onSelectResource(e.target.value)}
            className="rounded-md border border-[#30343B] bg-[#111318] px-2 py-1 text-xs font-mono text-[#E6E1E5] outline-none focus:border-[#5C616B] transition-colors cursor-pointer max-w-sm truncate"
          >
            <option value="ALL">
              {selectedNs === "all"
                ? "All Resources (All Containers Cluster-Wide)"
                : `All Resources (All Pods in ${selectedNs})`}
            </option>

            {podsInNs.length > 0 && (
              <optgroup label="Pods">
                {podsInNs.map((pod) => (
                  <option key={`pod:${pod.name}`} value={`pod:${pod.name}`}>
                    {pod.name} {pod.status ? `(${pod.status})` : ""}
                  </option>
                ))}
              </optgroup>
            )}

            {depsInNs.length > 0 && (
              <optgroup label="Deployments">
                {depsInNs.map((dep) => (
                  <option key={`deployment:${dep.name}`} value={`deployment:${dep.name}`}>
                    {dep.name} (Deployment)
                  </option>
                ))}
              </optgroup>
            )}

            {statefulInNs.length > 0 && (
              <optgroup label="StatefulSets">
                {statefulInNs.map((ss) => (
                  <option key={`statefulset:${ss.name}`} value={`statefulset:${ss.name}`}>
                    {ss.name} (StatefulSet)
                  </option>
                ))}
              </optgroup>
            )}

            {daemonInNs.length > 0 && (
              <optgroup label="DaemonSets">
                {daemonInNs.map((ds) => (
                  <option key={`daemonset:${ds.name}`} value={`daemonset:${ds.name}`}>
                    {ds.name} (DaemonSet)
                  </option>
                ))}
              </optgroup>
            )}

            {jobsInNs.length > 0 && (
              <optgroup label="Jobs">
                {jobsInNs.map((job) => (
                  <option key={`job:${job.name}`} value={`job:${job.name}`}>
                    {job.name} (Job)
                  </option>
                ))}
              </optgroup>
            )}

            {servicesInNs.length > 0 && (
              <optgroup label="Services">
                {servicesInNs.map((svc) => (
                  <option key={`service:${svc.name}`} value={`service:${svc.name}`}>
                    {svc.name} (Service)
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[180px]">
          <input
            type="text"
            placeholder="Search in logs..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-md border border-[#30343B] bg-[#111318] pl-2.5 pr-6 py-1 text-xs font-mono text-[#E6E1E5] placeholder-[#5C616B] outline-none focus:border-[#5C616B] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5C616B] hover:text-[#E6E1E5] text-xs cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Level Filter Buttons */}
        <div className="flex items-center rounded-md border border-[#30343B] bg-[#111318] p-0.5">
          {LOG_LEVELS.map((level) => {
            const count = levelCounts[level] || 0;
            const isSelected = selectedLevel === level;
            return (
              <button
                key={level}
                onClick={() => onSelectLevel(level)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[#30343B] text-[#E6E1E5] font-semibold"
                    : "text-[#92959D] hover:text-[#E6E1E5]"
                }`}
              >
                <span>{level}</span>
                {count > 0 && <span className="text-[10px] text-[#777D87]">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Stream Actions & Status */}
      <div className="flex items-center gap-2">
        {/* Stream Diagnostics & Health Toggle */}
        <button
          onClick={onToggleDiagnostics}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-mono transition-colors cursor-pointer ${
            healthSummary.retryingStreams > 0 || healthSummary.failedStreams > 0
              ? "border-[#F4C26B]/40 bg-[#F4C26B]/10 text-[#F4C26B] hover:bg-[#F4C26B]/20"
              : "border-[#30343B] bg-[#111318] text-[#C4C7C5] hover:text-[#E6E1E5] hover:bg-[#23262D]"
          }`}
          title="Inspect individual stream health and connection diagnostics"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              healthSummary.retryingStreams > 0 || healthSummary.failedStreams > 0
                ? "bg-[#F4C26B]"
                : status === "streaming"
                ? "bg-[#6DD6A8]"
                : "bg-[#777D87]"
            }`}
          />
          <span>
            {healthSummary.totalStreams > 0
              ? `${healthSummary.activeStreams}/${healthSummary.totalStreams} Streams`
              : status === "streaming"
              ? "Live"
              : "Diagnostics"}
          </span>
          {healthSummary.retryingStreams > 0 && (
            <span className="rounded bg-[#F4C26B]/20 px-1 text-[10px] text-[#F4C26B] font-bold">
              {healthSummary.retryingStreams}
            </span>
          )}
        </button>

        <button
          onClick={onToggleTailing}
          className="rounded-md border border-[#30343B] bg-[#111318] px-2.5 py-1 text-xs font-mono text-[#C4C7C5] hover:text-[#E6E1E5] hover:bg-[#23262D] transition-colors cursor-pointer"
        >
          {isTailing ? "Pause" : "Resume"}
        </button>

        <button
          onClick={onClearLogs}
          className="rounded-md border border-[#30343B] bg-[#111318] px-2.5 py-1 text-xs font-mono text-[#C4C7C5] hover:text-[#E6E1E5] hover:bg-[#23262D] transition-colors cursor-pointer"
        >
          Clear
        </button>

        <button
          onClick={onCopyLogs}
          className="rounded-md border border-[#30343B] bg-[#111318] px-2.5 py-1 text-xs font-mono text-[#C4C7C5] hover:text-[#E6E1E5] hover:bg-[#23262D] transition-colors cursor-pointer"
        >
          {copied ? "Copied" : "Copy"}
        </button>

        <button
          onClick={onDownloadLogs}
          className="rounded-md border border-[#30343B] bg-[#111318] px-2.5 py-1 text-xs font-mono text-[#C4C7C5] hover:text-[#E6E1E5] hover:bg-[#23262D] transition-colors cursor-pointer"
        >
          Export
        </button>
      </div>
    </div>
  );
}
