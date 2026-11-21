import { useState, useMemo } from "react";
import {
  MdClose as CloseIcon,
  MdRefresh as RefreshIcon,
  MdCheckCircle as ActiveIcon,
  MdWarning as WarningIcon,
  MdError as ErrorIcon,
  MdStopCircle as StopIcon,
} from "react-icons/md";
import type { StreamDiagnostic, StreamHealthSummary } from "../../types/logs";

interface LogDiagnosticsPanelProps {
  diagnostics: StreamDiagnostic[];
  healthSummary: StreamHealthSummary;
  onClose: () => void;
}

export function LogDiagnosticsPanel({
  diagnostics,
  healthSummary,
  onClose,
}: LogDiagnosticsPanelProps) {
  const [filter, setFilter] = useState<"ALL" | "ISSUES" | "ACTIVE">("ALL");
  const [search, setSearch] = useState("");

  const filteredDiagnostics = useMemo(() => {
    return diagnostics.filter((d) => {
      if (filter === "ISSUES") {
        if (d.status === "active" || d.status === "terminated") return false;
      } else if (filter === "ACTIVE") {
        if (d.status !== "active") return false;
      }

      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        d.source.toLowerCase().includes(q) ||
        d.reason.toLowerCase().includes(q) ||
        d.status.toLowerCase().includes(q)
      );
    });
  }, [diagnostics, filter, search]);

  const activeCount = healthSummary.activeStreams || diagnostics.filter((d) => d.status === "active").length;
  const issuesCount = diagnostics.filter((d) => d.status === "retrying" || d.status === "backoff" || d.status === "failed" || d.status === "permission_denied").length;
  const totalCount = healthSummary.totalStreams || diagnostics.length;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-[#191B20] border-l border-[#30343B] shadow-2xl flex flex-col font-sans select-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#30343B] px-5 py-3.5 bg-[#16181D] shrink-0 select-none">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-[#E6E1E5]">Stream Diagnostics & Health</h2>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                issuesCount > 0
                  ? "bg-[#F4C26B]/15 text-[#F4C26B] border border-[#F4C26B]/30"
                  : "bg-[#6DD6A8]/15 text-[#6DD6A8] border border-[#6DD6A8]/30"
              }`}
            >
              {issuesCount > 0 ? `${issuesCount} Degraded` : "All Healthy"}
            </span>
          </div>
          <p className="text-xs text-[#92959D] mt-0.5 font-mono">
            {totalCount} total container log streams monitored
          </p>
        </div>

        <button
          onClick={onClose}
          className="rounded-lg p-1 text-[#92959D] hover:bg-[#23262D] hover:text-[#E6E1E5] transition-colors cursor-pointer"
        >
          <CloseIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Health Overview Metric Cards */}
      <div className="grid grid-cols-3 gap-2 p-3 bg-[#111318] border-b border-[#30343B] shrink-0 select-none">
        <div className="rounded-lg border border-[#30343B] bg-[#16181D] p-2.5">
          <span className="text-[10px] font-mono uppercase text-[#92959D] tracking-wider">Total Streams</span>
          <div className="text-lg font-bold font-mono text-[#E6E1E5] mt-0.5">{totalCount}</div>
        </div>
        <div className="rounded-lg border border-[#30343B] bg-[#16181D] p-2.5">
          <span className="text-[10px] font-mono uppercase text-[#6DD6A8] tracking-wider">Active</span>
          <div className="text-lg font-bold font-mono text-[#6DD6A8] mt-0.5">{activeCount}</div>
        </div>
        <div className="rounded-lg border border-[#30343B] bg-[#16181D] p-2.5">
          <span className="text-[10px] font-mono uppercase text-[#F4C26B] tracking-wider">Retrying / Issues</span>
          <div className="text-lg font-bold font-mono text-[#F4C26B] mt-0.5">{issuesCount}</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#30343B] bg-[#16181D] shrink-0">
        <div className="flex items-center gap-1 rounded-md border border-[#30343B] bg-[#111318] p-0.5 select-none">
          <button
            onClick={() => setFilter("ALL")}
            className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
              filter === "ALL" ? "bg-[#30343B] text-[#E6E1E5] font-semibold" : "text-[#92959D] hover:text-[#E6E1E5]"
            }`}
          >
            All ({diagnostics.length})
          </button>
          <button
            onClick={() => setFilter("ISSUES")}
            className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
              filter === "ISSUES" ? "bg-[#30343B] text-[#F4C26B] font-semibold" : "text-[#92959D] hover:text-[#E6E1E5]"
            }`}
          >
            Issues ({issuesCount})
          </button>
          <button
            onClick={() => setFilter("ACTIVE")}
            className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
              filter === "ACTIVE" ? "bg-[#30343B] text-[#6DD6A8] font-semibold" : "text-[#92959D] hover:text-[#E6E1E5]"
            }`}
          >
            Active ({activeCount})
          </button>
        </div>

        <input
          type="text"
          placeholder="Filter source or reason..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-[#30343B] bg-[#111318] px-2.5 py-1 text-xs font-mono text-[#E6E1E5] placeholder-[#5C616B] outline-none focus:border-[#5C616B] w-48"
        />
      </div>

      {/* Diagnostics List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#23262D] p-3 space-y-2">
        {filteredDiagnostics.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-[#777D87] select-none">
            <ActiveIcon className="h-8 w-8 text-[#6DD6A8]/50 mb-2" />
            <p className="font-semibold text-[#C4C7C5] text-sm">No stream diagnostics reported</p>
            <p className="text-xs text-[#92959D] mt-1 font-mono">
              {filter === "ISSUES" ? "All active container streams are healthy" : "Waiting for container stream events"}
            </p>
          </div>
        ) : (
          filteredDiagnostics.map((item) => {
            const isAct = item.status === "active";
            const isRetry = item.status === "retrying" || item.status === "backoff";
            const isTerm = item.status === "terminated";
            const isFail = item.status === "failed" || item.status === "permission_denied";

            const badgeBg = isAct
              ? "bg-[#6DD6A8]/10 text-[#6DD6A8] border-[#6DD6A8]/25"
              : isRetry
              ? "bg-[#F4C26B]/10 text-[#F4C26B] border-[#F4C26B]/25"
              : isFail
              ? "bg-[#F2B8B5]/10 text-[#F2B8B5] border-[#F2B8B5]/25"
              : "bg-[#777D87]/15 text-[#C4C7C5] border-[#777D87]/30";

            const Icon = isAct ? ActiveIcon : isRetry ? RefreshIcon : isFail ? ErrorIcon : isTerm ? StopIcon : WarningIcon;

            return (
              <div
                key={item.source}
                className="rounded-lg border border-[#30343B] bg-[#111318] p-3 transition-colors hover:border-[#424750]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs font-semibold text-[#E6E1E5] break-all">
                      {item.source}
                    </span>
                    {item.namespace && (
                      <span className="ml-2 text-[10px] font-mono text-[#92959D]">
                        ns: {item.namespace}
                      </span>
                    )}
                  </div>

                  <span
                    className={`flex items-center gap-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold border uppercase tracking-wider ${badgeBg}`}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{item.status}</span>
                  </span>
                </div>

                <div className="mt-2 text-xs font-mono text-[#C4C7C5] whitespace-pre-wrap break-words leading-relaxed bg-[#16181D] p-2 rounded border border-[#23262D]">
                  {item.reason || "No detail provided"}
                </div>

                <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-[#777D87]">
                  <span>Updated: {item.timestamp.slice(11, 19)}</span>
                  {item.retryCount !== undefined && item.retryCount > 0 && (
                    <span className="text-[#F4C26B]">
                      Retry attempts: {item.retryCount}
                      {item.nextRetryMs ? ` • Next in ${(item.nextRetryMs / 1000).toFixed(1)}s` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
