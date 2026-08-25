import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  MdClose as X,
  MdTerminal as Terminal,
  MdSearch as Search,
  MdPlayArrow as Play,
  MdPause as Pause,
  MdDelete as Trash2,
  MdContentCopy as Copy,
  MdCheck as Check,
  MdArrowDownward as ArrowDown,
  MdFilterList as Filter,
} from "react-icons/md";
import { usePodLogs } from "../../hooks/usePodLogs";
import type { LogLevel } from "../../types/logs";

interface PodLogDrawerProps {
  podName: string | null;
  namespace?: string;
  isOpen: boolean;
  onClose: () => void;
}

const LOG_LEVELS: Array<LogLevel | "ALL"> = ["ALL", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

export function PodLogDrawer({
  podName,
  namespace = "default",
  isOpen,
  onClose,
}: PodLogDrawerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | "ALL">("ALL");
  const [copied, setCopied] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [unreadLogsCount, setUnreadLogsCount] = useState(0);

  const logContainerRef = useRef<HTMLDivElement>(null);
  const prevLogsLengthRef = useRef(0);

  const {
    logs,
    status,
    isTailing,
    setIsTailing,
    clearLogs,
    copyLogs,
  } = usePodLogs({
    podName: isOpen ? podName : null,
    namespace,
    enabled: isOpen,
  });

  // Filter logs by search query and level
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesLevel = selectedLevel === "ALL" || log.level === selectedLevel;
      if (!matchesLevel) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        log.level.toLowerCase().includes(q) ||
        (log.timestamp && log.timestamp.toLowerCase().includes(q)) ||
        (log.container && log.container.toLowerCase().includes(q))
      );
    });
  }, [logs, selectedLevel, searchQuery]);

  // Handle scroll detection
  const handleScroll = useCallback(() => {
    const container = logContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    
    // If within 40px of bottom, consider user to be at the bottom
    if (distanceFromBottom <= 40) {
      setIsUserScrolledUp(false);
      setUnreadLogsCount(0);
    } else {
      setIsUserScrolledUp(true);
    }
  }, []);

  // Smart auto-scroll effect
  useEffect(() => {
    const container = logContainerRef.current;
    if (!container) return;

    const newLogsCount = logs.length - prevLogsLengthRef.current;
    prevLogsLengthRef.current = logs.length;

    if (!isUserScrolledUp) {
      // User is at bottom -> Auto scroll
      container.scrollTop = container.scrollHeight;
    } else if (newLogsCount > 0) {
      // User is scrolled up -> increment unread count badge
      setUnreadLogsCount((prev) => prev + newLogsCount);
    }
  }, [logs, isUserScrolledUp]);

  const scrollToBottom = useCallback(() => {
    const container = logContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    setIsUserScrolledUp(false);
    setUnreadLogsCount(0);
  }, []);

  const handleCopy = useCallback(() => {
    copyLogs();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyLogs]);

  if (!isOpen || !podName) return null;

  const renderLevelBadge = (level: LogLevel) => {
    switch (level) {
      case "TRACE":
        return "bg-neutral-800/80 text-neutral-400 border-neutral-700/60";
      case "DEBUG":
        return "bg-blue-950/80 text-blue-400 border-blue-800/50";
      case "INFO":
        return "bg-cyan-950/80 text-cyan-400 border-cyan-800/50";
      case "WARN":
        return "bg-amber-950/80 text-amber-300 border-amber-800/50";
      case "ERROR":
        return "bg-red-950/80 text-red-400 border-red-800/50 font-bold";
      case "FATAL":
        return "bg-fuchsia-950/80 text-fuchsia-300 border-fuchsia-800/50 font-bold animate-pulse";
      default:
        return "bg-neutral-800 text-neutral-300 border-neutral-700";
    }
  };

  const formatTimestamp = (ts?: string) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
    } catch {
      return ts;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <aside className="relative flex h-full w-full max-w-3xl flex-col bg-[#0b0c10] text-neutral-100 border-l border-neutral-800/80 shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Region 1: Drawer Header */}
        <div className="flex flex-col gap-3 border-b border-neutral-800/80 bg-[#121318] p-4 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-mono text-sm font-bold text-neutral-100">{podName}</h3>
                  <span className="rounded-md bg-neutral-800/80 px-2 py-0.5 font-mono text-[10px] text-neutral-400 border border-neutral-700/50">
                    {namespace}
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400">Kubernetes Pod Log Stream Inspector</p>
              </div>
            </div>

            {/* Top Header Actions */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium border border-neutral-800">
                <span className="relative flex h-2 w-2">
                  {status === "streaming" && isTailing && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      status === "streaming" && isTailing
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />
                </span>
                <span className="font-mono text-[11px] text-neutral-300 capitalize">
                  {isTailing ? status : "Paused"}
                </span>
              </div>

              <button
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 hover:text-white transition-all border border-neutral-800 hover:border-neutral-700 shadow-sm active:scale-95 cursor-pointer"
                title="Close Log Terminal"
              >
                <X className="h-4 w-4 text-neutral-400" />
                <span>Close Terminal</span>
              </button>
            </div>
          </div>

          {/* Region 2: Toolbar (Search, Filter, Actions) */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search log messages or timestamps..."
                className="w-full rounded-lg bg-neutral-900/90 py-1.5 pl-8 pr-3 font-mono text-xs text-neutral-200 placeholder-neutral-500 border border-neutral-800 focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>

            {/* Level Filter Dropdown / Pill */}
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
              <div className="flex items-center gap-1 rounded-lg bg-neutral-900 p-1 border border-neutral-800">
                {LOG_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setSelectedLevel(lvl)}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold transition-all ${
                      selectedLevel === lvl
                        ? "bg-blue-500 text-white shadow-sm"
                        : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Control Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsTailing((prev) => !prev)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-xs font-medium border transition-all ${
                  isTailing
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                }`}
                title={isTailing ? "Pause Stream Tailing" : "Resume Stream Tailing"}
              >
                {isTailing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                <span>{isTailing ? "Pause" : "Resume"}</span>
              </button>

              <button
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-lg bg-neutral-900 p-1.5 text-xs text-neutral-300 border border-neutral-800 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                title="Copy Logs to Clipboard"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>

              <button
                onClick={onClose}
                className="flex items-center gap-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1.5 text-xs font-semibold hover:bg-red-500/20 transition-all cursor-pointer shrink-0"
                title="Close Log Terminal"
              >
                <X className="h-4 w-4" />
                <span>Close</span>
              </button>

              <button
                onClick={clearLogs}
                className="flex items-center gap-1 rounded-lg bg-neutral-900 p-1.5 text-xs text-neutral-300 border border-neutral-800 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-colors"
                title="Clear Output Logs"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Region 3: Log Output Terminal Body */}
        <div className="relative flex-1 bg-[#07080b] p-4 overflow-hidden">
          <div
            ref={logContainerRef}
            onScroll={handleScroll}
            className="h-full w-full overflow-y-auto font-mono text-xs space-y-1 pr-2 select-text"
          >
            {filteredLogs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center p-8 text-neutral-500">
                <Terminal className="h-10 w-10 mb-3 opacity-30" />
                <p className="font-semibold text-neutral-400">No matching log records found</p>
                <p className="text-[11px] mt-1 text-neutral-600">
                  {searchQuery || selectedLevel !== "ALL"
                    ? "Try adjusting your search filter criteria"
                    : "Waiting for incoming log stream frames..."}
                </p>
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div
                  key={log.id || idx}
                  className="group flex items-start gap-3 rounded px-2 py-1 leading-relaxed hover:bg-neutral-900/70 transition-colors"
                >
                  <span className="w-8 shrink-0 text-right font-mono text-[10px] text-neutral-600 select-none group-hover:text-neutral-500">
                    {idx + 1}
                  </span>

                  <span className="shrink-0 font-mono text-[11px] text-neutral-500 select-none">
                    [{formatTimestamp(log.timestamp)}]
                  </span>

                  <span
                    className={`shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] uppercase border ${renderLevelBadge(
                      log.level
                    )}`}
                  >
                    {log.level.padEnd(5)}
                  </span>

                  <span className="flex-1 font-mono text-neutral-200 break-all whitespace-pre-wrap">
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Region 4: Scroll to Bottom Floating Badge */}
          {isUserScrolledUp && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-6 right-6 flex items-center gap-2 rounded-full bg-blue-600 px-3.5 py-2 font-mono text-xs font-semibold text-white shadow-xl hover:bg-blue-500 transition-all active:scale-95 animate-in fade-in slide-in-from-bottom-2 duration-200 z-10"
            >
              <ArrowDown className="h-3.5 w-3.5 animate-bounce" />
              <span>
                {unreadLogsCount > 0 ? `${unreadLogsCount} new logs` : "Scroll to latest"}
              </span>
            </button>
          )}
        </div>

        {/* Region 5: Terminal Footer Bar */}
        <div className="flex items-center justify-between border-t border-neutral-800/80 bg-[#101115] px-4 py-2 text-[11px] font-mono text-neutral-400 shrink-0">
          <div className="flex items-center gap-3">
            <span>
              Total Lines: <strong className="text-neutral-200">{logs.length}</strong>
            </span>
            <span>
              Filtered: <strong className="text-neutral-200">{filteredLogs.length}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 text-neutral-500">
            <span>Tail: {isTailing ? "Active" : "Paused"}</span>
            <span>•</span>
            <span>Target: {podName}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
