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

  const isErr = level === "ERROR";
  const isWarn = level === "WARN";
  const isEvt = message.startsWith("[EVENT]");

  const badgeBg = isErr
    ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
    : isWarn
    ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
    : isEvt
    ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";

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

  let podTag = log.source || log.podName || "";
  if (podTag.includes("/")) {
    podTag = podTag.split("/")[0];
  }
  if (podTag.length > 20) {
    const parts = podTag.split("-");
    if (parts.length > 2) {
      podTag = `${parts[0]}-${parts[parts.length - 2] || ""}-${parts[parts.length - 1]}`;
    }
  }

  const attrEntries = Object.entries(attributes);

  return (
    <div className="border-b border-neutral-900/60 font-mono text-xs hover:bg-neutral-900/40 transition-colors">
      <div
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center gap-2 py-1 px-2 cursor-pointer select-none min-w-0"
      >
        <span className="text-neutral-600 text-[10px] w-6 shrink-0 text-right select-none">
          {index + 1}
        </span>

        <span className="text-neutral-500 text-[10px] shrink-0">{tsDisplay}</span>

        <span
          className={`shrink-0 rounded px-1.5 py-0.2 text-[10px] font-bold border uppercase tracking-wider ${badgeBg}`}
        >
          {level}
        </span>

        {showSource && podTag && (
          <span className="shrink-0 rounded bg-cyan-950/60 border border-cyan-800/40 px-1.5 py-0.2 text-[10px] text-cyan-300 truncate max-w-[140px]">
            [{podTag}]
          </span>
        )}

        <span className="text-neutral-200 font-medium truncate shrink min-w-0 flex-1 flex items-center gap-2">
          <span>{message}</span>
          {count > 1 && (
            <span className="shrink-0 rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.2 text-[10px] font-bold text-amber-300">
              x{count}
            </span>
          )}
        </span>

        {attrEntries.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 shrink-0 overflow-hidden max-w-[300px]">
            {attrEntries.slice(0, 3).map(([k, v]) => (
              <span
                key={k}
                className="rounded bg-neutral-900 border border-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 truncate max-w-[120px]"
              >
                <span className="text-neutral-500">{k}=</span>
                <span className="text-neutral-300">{String(v)}</span>
              </span>
            ))}
            {attrEntries.length > 3 && (
              <span className="text-[10px] text-neutral-500 font-bold">
                +{attrEntries.length - 3}
              </span>
            )}
          </div>
        )}

        <button className="text-neutral-500 hover:text-neutral-300 shrink-0 ml-1 cursor-pointer">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-blue-400" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="bg-black/95 border-t border-b border-neutral-800 p-3 my-1 ml-8 mr-2 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
              {isJson ? `Structured JSON Payload (Repeated ${count}x)` : `Raw Console Output (Repeated ${count}x)`}
            </span>
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 transition-colors border border-neutral-700 cursor-pointer"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy JSON"}
            </button>
          </div>
          <pre className="text-[11px] text-emerald-400/90 font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-60 p-2 bg-neutral-950 rounded border border-neutral-900 leading-relaxed">
            {rawJson ? JSON.stringify(rawJson, null, 2) : log.message}
          </pre>
        </div>
      )}
    </div>
  );
}
