import { useState, useMemo } from "react";
import {
  MdPlayArrow as Play,
  MdPause as Pause,
  MdContentCopy as Copy,
  MdCheck as Check,
  MdTerminal as Terminal,
} from "react-icons/md";
import type { SelectedTarget } from "../InspectorDrawer";
import { useResourceLogs } from "../../../hooks/useResourceLogs";
import { LogRow } from "../LogRow";
import { aggregateConsecutiveLogs } from "../../../utils/logAggregator";

interface LogsTabProps {
  target: NonNullable<SelectedTarget>;
  onOpenLogTerminal?: (podName: string, namespace?: string) => void;
}

export function LogsTab({ target, onOpenLogTerminal }: LogsTabProps) {
  const [copied, setCopied] = useState(false);
  const [hideNoise, setHideNoise] = useState(true);

  const targetRecord = target.data as unknown as Record<string, unknown>;
  const resourceName = target.data?.name || "";
  const resourceNs = String(targetRecord.namespace || "default");
  const resourceKind =
    target.type === "pod"
      ? "Pod"
      : target.type === "service"
      ? "Service"
      : target.type === "ingress"
      ? "Ingress"
      : "Workload";

  const {
    logs,
    status,
    isTailing,
    setIsTailing,
    copyLogs,
  } = useResourceLogs({
    name: resourceName,
    kind: resourceKind,
    namespace: resourceNs,
    enabled: true,
  });

  const processedLogs = useMemo(() => {
    return aggregateConsecutiveLogs(logs, hideNoise);
  }, [logs, hideNoise]);

  const handleCopy = () => {
    copyLogs();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 flex items-center gap-2">
          <span>
            {status === "streaming"
              ? "🟢 Live Streaming"
              : status === "connecting"
              ? "🟡 Connecting..."
              : "⚪ Paused"}
          </span>
          <span>({processedLogs.length} items)</span>
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHideNoise((prev) => !prev)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-mono transition-colors cursor-pointer ${
              hideNoise
                ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                : "bg-neutral-900 text-neutral-400 border-neutral-800 hover:bg-neutral-800"
            }`}
            title="Suppress repetitive heartbeat logs"
          >
            <span>{hideNoise ? "🔇 Noise: Hidden" : "🔊 Noise: Shown"}</span>
          </button>
          {target.type === "pod" && onOpenLogTerminal && (
            <button
              onClick={() => onOpenLogTerminal(target.data.name, resourceNs)}
              className="flex items-center gap-1 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/20 transition-colors cursor-pointer"
            >
              <Terminal className="h-3.5 w-3.5" />
              Full Terminal
            </button>
          )}
          <button
            onClick={() => setIsTailing((prev) => !prev)}
            className="flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            {isTailing ? (
              <>
                <Pause className="h-3 w-3 text-amber-400" /> Pause
              </>
            ) : (
              <>
                <Play className="h-3 w-3 text-emerald-400" /> Resume
              </>
            )}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Copy
              </>
            )}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-black/90 p-1 font-mono text-xs h-[380px] overflow-y-auto space-y-0.5 leading-relaxed">
        {processedLogs.length === 0 ? (
          <div className="text-neutral-500 italic p-4 text-center">
            {hideNoise ? "No signal logs found (heartbeat noise is hidden)" : `Waiting for live stdout/stderr logs or events from ${resourceKind}/${resourceName}...`}
          </div>
        ) : (
          processedLogs.map((l, idx) => (
            <LogRow key={l.id || idx} log={l} index={idx} showSource={target.type !== "pod"} />
          ))
        )}
      </div>
    </div>
  );
}
