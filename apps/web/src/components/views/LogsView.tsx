import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useUIStore } from "../../store/useUIStore";
import { useResourceLogs } from "../../hooks/useResourceLogs";
import type { LogLevel } from "../../types/logs";
import { LogRow } from "../drawer/LogRow";
import { parseLogPayload } from "../../utils/logParser";
import { aggregateConsecutiveLogs } from "../../utils/logAggregator";
import { LogDiagnosticsPanel } from "./LogDiagnosticsPanel";
import { LogsToolbar } from "./LogsToolbar";

interface LogsViewProps {
  initialPodName?: string | null;
  initialNamespace?: string;
}

export function LogsView({ initialPodName, initialNamespace }: LogsViewProps) {
  const pods = useTopologyStore((s) => s.pods);
  const deployments = useTopologyStore((s) => s.deployments);
  const statefulSets = useTopologyStore((s) => s.statefulSets);
  const daemonSets = useTopologyStore((s) => s.daemonSets);
  const jobs = useTopologyStore((s) => s.jobs);
  const services = useTopologyStore((s) => s.services);
  const selectedGlobalNs = useUIStore((s) => s.selectedNamespaces[0]);

  // Extract all unique namespaces present across cluster resources, with "all" (Cluster-Wide) option
  const availableNamespaces = useMemo(() => {
    const set = new Set<string>();
    pods.forEach((p) => p.namespace && set.add(String(p.namespace)));
    deployments.forEach((d) => d.namespace && set.add(String(d.namespace)));
    statefulSets.forEach((s) => s.namespace && set.add(String(s.namespace)));
    services.forEach((s) => s.namespace && set.add(String(s.namespace)));
    if (set.size === 0) set.add("default");
    return ["all", ...Array.from(set).sort()];
  }, [pods, deployments, statefulSets, services]);

  // User manual selections
  const [userSelectedNs, setUserSelectedNs] = useState<string | null>(null);
  const [userSelectedTargetId, setUserSelectedTargetId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Active Namespace derived cleanly
  const selectedNs = useMemo(() => {
    if (userSelectedNs && availableNamespaces.includes(userSelectedNs)) {
      return userSelectedNs;
    }
    if (initialNamespace && availableNamespaces.includes(initialNamespace)) {
      return initialNamespace;
    }
    if (selectedGlobalNs && availableNamespaces.includes(selectedGlobalNs)) {
      return selectedGlobalNs;
    }
    return availableNamespaces[1] || availableNamespaces[0] || "default";
  }, [userSelectedNs, initialNamespace, selectedGlobalNs, availableNamespaces]);

  // Filtered resources in active namespace (or all resources if cluster-wide)
  const podsInNs = useMemo(
    () => (selectedNs === "all" ? pods : pods.filter((p) => (p.namespace || "default") === selectedNs)),
    [pods, selectedNs]
  );
  const depsInNs = useMemo(
    () => (selectedNs === "all" ? deployments : deployments.filter((d) => (d.namespace || "default") === selectedNs)),
    [deployments, selectedNs]
  );
  const statefulInNs = useMemo(
    () => (selectedNs === "all" ? statefulSets : statefulSets.filter((s) => (s.namespace || "default") === selectedNs)),
    [statefulSets, selectedNs]
  );
  const daemonInNs = useMemo(
    () => (selectedNs === "all" ? daemonSets : daemonSets.filter((d) => (d.namespace || "default") === selectedNs)),
    [daemonSets, selectedNs]
  );
  const jobsInNs = useMemo(
    () => (selectedNs === "all" ? jobs : jobs.filter((j) => (j.namespace || "default") === selectedNs)),
    [jobs, selectedNs]
  );
  const servicesInNs = useMemo(
    () => (selectedNs === "all" ? services : services.filter((s) => String(s.namespace || "default") === selectedNs)),
    [services, selectedNs]
  );

  // Active resource target derived cleanly (supports ALL resources, Pods, Deployments, StatefulSets, Jobs, Services)
  const selectedResource = useMemo(() => {
    const scopeLabel = selectedNs === "all" ? "Cluster-Wide" : selectedNs;

    // 1. Manual user override
    if (userSelectedTargetId) {
      if (userSelectedTargetId === "ALL") {
        return { id: "ALL", name: "ALL", kind: "all", label: `All Resources (${scopeLabel})` };
      }
      const [kindPrefix, resName] = userSelectedTargetId.split(":");
      if (kindPrefix && resName) {
        const capitalizedKind = kindPrefix.charAt(0).toUpperCase() + kindPrefix.slice(1);
        return { id: userSelectedTargetId, name: resName, kind: capitalizedKind, label: resName };
      }
    }

    // 2. Initial Pod prop if passed from canvas/inspector
    if (initialPodName && podsInNs.some((p) => p.name === initialPodName)) {
      return { id: `pod:${initialPodName}`, name: initialPodName, kind: "Pod", label: initialPodName };
    }

    // 3. Default to "ALL" so user immediately sees all logs across the scope
    return { id: "ALL", name: "ALL", kind: "all", label: `All Resources (${scopeLabel})` };
  }, [userSelectedTargetId, initialPodName, podsInNs, selectedNs]);

  // Filter and streaming state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | "ALL">("ALL");
  const [copied, setCopied] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [unreadLogsCount, setUnreadLogsCount] = useState(0);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogsLengthRef = useRef(0);

  // Hook into live resource log tailing
  const {
    logs,
    diagnostics,
    healthSummary,
    status,
    isTailing,
    setIsTailing,
    clearLogs,
    copyLogs,
  } = useResourceLogs({
    name: selectedResource.name,
    kind: selectedResource.kind,
    namespace: selectedNs,
    enabled: Boolean(selectedResource.name),
    maxLogs: 1000,
  });

  // Filter logs by level and text search
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const parsed = log.parsed || parseLogPayload(log.message, log.level);
      const matchesLevel = selectedLevel === "ALL" || parsed.level === selectedLevel;
      if (!matchesLevel) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        parsed.message.toLowerCase().includes(q) ||
        parsed.level.toLowerCase().includes(q) ||
        (log.timestamp && log.timestamp.toLowerCase().includes(q)) ||
        (log.source && log.source.toLowerCase().includes(q)) ||
        JSON.stringify(parsed.attributes).toLowerCase().includes(q)
      );
    });
  }, [logs, selectedLevel, searchQuery]);

  // Deduplicate consecutive identical logs
  const processedLogs = useMemo(() => {
    return aggregateConsecutiveLogs(filteredLogs, true);
  }, [filteredLogs]);

  // Level counts for filter pills
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: logs.length, ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0 };
    logs.forEach((log) => {
      const parsed = log.parsed || parseLogPayload(log.message, log.level);
      if (counts[parsed.level] !== undefined) {
        counts[parsed.level]++;
      }
    });
    return counts;
  }, [logs]);

  // Scroll detection
  const handleScroll = useCallback(() => {
    const container = logContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom <= 50) {
      setIsUserScrolledUp(false);
      setUnreadLogsCount(0);
    } else {
      setIsUserScrolledUp(true);
    }
  }, []);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (!isTailing) return;
    const container = logContainerRef.current;
    if (!container) return;

    if (processedLogs.length > prevLogsLengthRef.current) {
      if (isUserScrolledUp) {
        setUnreadLogsCount((prev) => prev + (processedLogs.length - prevLogsLengthRef.current));
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
    prevLogsLengthRef.current = processedLogs.length;
  }, [processedLogs.length, isTailing, isUserScrolledUp]);

  const scrollToBottom = () => {
    const container = logContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
      setIsUserScrolledUp(false);
      setUnreadLogsCount(0);
    }
  };

  const handleCopyLogs = () => {
    copyLogs();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadLogs = () => {
    if (logs.length === 0) return;
    const content = logs
      .map((l) => `[${l.timestamp || ""}] [${l.level}] ${l.source ? `(${l.source}) ` : ""}${l.message}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedResource.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen w-full pt-16 pl-16 pr-4 pb-4 flex flex-col bg-[#111318] text-[#E6E1E5]">
      {/* Streamlined, single cohesive control bar */}
      <LogsToolbar
        selectedNs={selectedNs}
        availableNamespaces={availableNamespaces}
        onSelectNs={(ns) => {
          setUserSelectedNs(ns);
          setUserSelectedTargetId("ALL");
        }}
        selectedResourceId={selectedResource.id}
        onSelectResource={(id) => setUserSelectedTargetId(id)}
        podsInNs={podsInNs}
        depsInNs={depsInNs}
        statefulInNs={statefulInNs}
        daemonInNs={daemonInNs}
        jobsInNs={jobsInNs}
        servicesInNs={servicesInNs}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedLevel={selectedLevel}
        onSelectLevel={setSelectedLevel}
        levelCounts={levelCounts}
        healthSummary={healthSummary}
        status={status}
        onToggleDiagnostics={() => setShowDiagnostics((prev) => !prev)}
        isTailing={isTailing}
        onToggleTailing={() => setIsTailing((prev) => !prev)}
        onClearLogs={clearLogs}
        onCopyLogs={handleCopyLogs}
        copied={copied}
        onDownloadLogs={handleDownloadLogs}
      />

      {/* Log Output Table Viewport */}
      <div className="relative flex-1 min-h-0 rounded-xl border border-[#30343B] bg-[#111318] flex flex-col overflow-hidden mt-3 shadow-sm select-text">
        {/* Sticky Table Header */}
        <div className="flex items-center gap-2.5 border-b border-[#30343B] bg-[#16181D] px-3 py-1.5 text-[11px] font-mono text-[#92959D] uppercase tracking-wider shrink-0 select-none">
          <span className="w-7 text-right">#</span>
          <span className="w-24">Timestamp</span>
          <span className="w-14 text-center">Level</span>
          <span className="shrink-0">Component</span>
          <span className="flex-1">Message</span>
          <span className="text-[10px] text-[#777D87] lowercase">{processedLogs.length} events</span>
        </div>

        {/* Scrollable Log Lines with Cursor Selection and Text Wrapping */}
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto font-mono text-xs select-text cursor-text divide-y divide-[#1D2026]"
        >
          {processedLogs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-[#777D87] select-none">
              <p className="font-semibold text-[#C4C7C5] text-sm">
                {status === "streaming" ? "Waiting for container logs..." : "No logs available"}
              </p>
              <p className="text-xs text-[#92959D] mt-1 font-mono">
                {selectedResource.id === "ALL"
                  ? selectedNs === "all"
                    ? "Listening to all containers cluster-wide"
                    : `Listening to all pods in namespace "${selectedNs}"`
                  : `Listening to ${selectedResource.kind} "${selectedResource.name}"`}
              </p>
              {diagnostics.length > 0 && (
                <button
                  onClick={() => setShowDiagnostics(true)}
                  className="mt-3 rounded-md border border-[#30343B] bg-[#191B20] px-3 py-1 text-xs font-mono text-[#F4C26B] hover:bg-[#23262D] transition-colors cursor-pointer"
                >
                  Inspect {diagnostics.length} stream diagnostic events →
                </button>
              )}
            </div>
          ) : (
            processedLogs.map((log, index) => (
              <LogRow key={log.id || index} log={log} index={index} showSource={true} />
            ))
          )}
        </div>

        {/* Floating "Jump to bottom" button */}
        {isUserScrolledUp && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-[#23262D] border border-[#424750] px-3 py-1 font-mono text-xs text-[#E6E1E5] shadow-lg hover:bg-[#30343B] transition-colors cursor-pointer select-none"
          >
            <span>↓ Jump to bottom</span>
            {unreadLogsCount > 0 && (
              <span className="rounded bg-[#6DD6A8]/20 text-[#6DD6A8] px-1 text-[10px] font-bold">
                +{unreadLogsCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Stream Diagnostics Panel Slide-over */}
      {showDiagnostics && (
        <LogDiagnosticsPanel
          diagnostics={diagnostics}
          healthSummary={healthSummary}
          onClose={() => setShowDiagnostics(false)}
        />
      )}
    </div>
  );
}
