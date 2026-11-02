import { useState } from "react";
import {
  MdContentCopy as Copy,
  MdCheck as Check,
  MdChevronRight as ChevronRight,
  MdExpandMore as ChevronDown,
} from "react-icons/md";
import type { PodLogLine } from "../../types/logs";
import { parseLogPayload } from "../../utils/logParser";
import type { AggregatedLogLine } from "../../utils/logAggregator";

interface LogRowProps {
  log: PodLogLine | AggregatedLogLine;
  index: number;
  showSource?: boolean;
}

export function LogRow({ log, index, showSource = true }: LogRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const agg = log as AggregatedLogLine;
  const count = agg.count || 1;
  const firstTs = agg.firstTimestamp || log.timestamp;
  const lastTs = agg.lastTimestamp || log.timestamp;

  const parsed = log.parsed || parseLogPayload(log.message, log.level);
  const { level, message, attributes, rawJson, isJson } = parsed;

  const isErr = level === "ERROR" || level === "FATAL";
  const isWarn = level === "WARN";
  const isEvt = message.startsWith("[EVENT]");

  // Strict adherence to EnvScale design system palette (no neon fonts)
  const badgeClass = isErr
    ? "bg-[#F2B8B5]/10 text-[#F2B8B5] border-[#F2B8B5]/25"
    : isWarn
    ? "bg-[#F4C26B]/10 text-[#F4C26B] border-[#F4C26B]/25"
    : isEvt
    ? "bg-[#D0BCFF]/10 text-[#D0BCFF] border-[#D0BCFF]/25"
    : "bg-[#6DD6A8]/10 text-[#6DD6A8] border-[#6DD6A8]/25";

  const handleCopyJson = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = rawJson ? JSON.stringify(rawJson, null, 2) : log.message;
    navigator.clipboard.writeText(payload).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tsDisplay =
    count > 1 && firstTs !== lastTs
      ? `[${firstTs.slice(11, 19)} – ${lastTs.slice(11, 19)}]`
      : `[${(log.timestamp || new Date().toISOString()).slice(11, 23)}]`;

  // Full name of the component without any truncation or slicing
  const componentName = log.source || log.podName || "";
  const hasExpandableContent = isJson || Object.keys(attributes).length > 0;

  return (
    <div className="border-b border-[#23262D] font-mono text-xs hover:bg-[#16181D] transition-colors py-1.5 px-3 select-text">
      <div className="flex items-start gap-2.5 min-w-0">
        {/* Line Number */}
        <span className="text-[#5C616B] text-[11px] w-7 shrink-0 text-right select-none pt-0.5">
          {index + 1}
        </span>

        {/* Timestamp */}
        <span className="text-[#777D87] text-[11px] w-24 shrink-0 pt-0.5 select-text font-mono truncate">
          {tsDisplay}
        </span>

        {/* Level Badge */}
        <span
          className={`shrink-0 w-14 text-center rounded px-1 py-0.5 text-[10px] font-bold border uppercase tracking-wider select-none ${badgeClass}`}
        >
          {level}
        </span>

        {/* Full Component / Pod Name */}
        {showSource && componentName && (
          <span className="shrink-0 rounded bg-[#1E2127] border border-[#30343B] px-2 py-0.5 text-[11px] font-mono text-[#C4C7C5] select-text">
            {componentName}
          </span>
        )}

        {/* Message with full text wrapping and cursor selection */}
        <div className="flex-1 min-w-0 text-[#E6E1E5] font-mono text-xs whitespace-pre-wrap break-words leading-relaxed select-text pt-0.5">
          <span>{message}</span>
          {count > 1 && (
            <span className="ml-2 inline-block rounded bg-[#F4C26B]/15 border border-[#F4C26B]/30 px-1 py-0.2 text-[10px] font-bold text-[#F4C26B] select-none">
              x{count}
            </span>
          )}
        </div>

        {/* Expandable attributes button */}
        {hasExpandableContent && (
          <button
            onClick={() => setIsExpanded((prev) => !prev)}
            className="text-[#92959D] hover:text-[#E6E1E5] shrink-0 p-0.5 rounded hover:bg-[#23262D] transition-colors cursor-pointer select-none"
            title={isExpanded ? "Collapse attributes" : "Expand structured JSON attributes"}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Expanded JSON Inspector */}
      {isExpanded && (
        <div className="bg-[#0F1014] border border-[#30343B] p-3 my-2 ml-9 mr-2 rounded-lg space-y-2 select-text">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-[#92959D] tracking-wider select-none">
              {isJson ? `Structured Payload (${count}x)` : "Raw Log Payload"}
            </span>
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1 rounded bg-[#1E2127] px-2 py-0.5 text-[11px] text-[#C4C7C5] hover:text-[#E6E1E5] hover:bg-[#282C34] transition-colors border border-[#30343B] cursor-pointer"
            >
              {copied ? <Check className="h-3 w-3 text-[#6DD6A8]" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? "Copied" : "Copy Payload"}</span>
            </button>
          </div>
          <pre className="text-[11px] text-[#C4C7C5] font-mono whitespace-pre-wrap break-words overflow-x-auto max-h-60 p-2.5 bg-[#16181D] rounded border border-[#23262D] leading-relaxed select-text">
            {rawJson ? JSON.stringify(rawJson, null, 2) : log.message}
          </pre>
        </div>
      )}
    </div>
  );
}
