import type {
  LogLevel,
  LogStreamStatus,
  NormalizedLogFrame,
  PodLogLine,
  StreamDiagnostic,
  StreamDiagnosticStatus,
  StreamHealthSummary,
} from "../types/logs";
import { parseLogPayload } from "./logParser";

export interface LogStreamQueryOptions {
  wsBaseUrl: string;
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  container?: string;
  tailLines?: number;
  follow?: boolean;
  previous?: boolean;
  timestamps?: boolean;
  sinceSeconds?: number;
  token?: string | null;
}

export function buildLogStreamWebSocketUrl(opts: LogStreamQueryOptions): string {
  const params = new URLSearchParams();
  params.set("clusterId", opts.clusterId);
  params.set("namespace", opts.namespace);
  params.set("kind", opts.kind);
  params.set("name", opts.name);
  params.set("tailLines", String(opts.tailLines ?? 100));

  if (opts.container) params.set("container", opts.container);
  if (opts.follow !== undefined) params.set("follow", String(opts.follow));
  if (opts.previous !== undefined) params.set("previous", String(opts.previous));
  if (opts.timestamps !== undefined) params.set("timestamps", String(opts.timestamps));
  if (opts.sinceSeconds !== undefined && opts.sinceSeconds > 0) {
    params.set("sinceSeconds", String(opts.sinceSeconds));
  }
  if (opts.token) {
    params.set("token", opts.token);
  }

  return `${opts.wsBaseUrl}/api/v1/stream/logs?${params.toString()}`;
}

export interface LogStreamState {
  logs: PodLogLine[];
  diagnostics: StreamDiagnostic[];
  healthSummary: StreamHealthSummary;
  status: LogStreamStatus;
  streamError: string | null;
  streamId: string | null;
  lastSequence: number;
}

const DISCONNECT_ERROR_CODES = new Set([
  "agent_disconnected",
  "agent_session_replaced",
  "cluster_disconnected",
  "cluster_unregistered",
]);

export function createInitialLogStreamState(status: LogStreamStatus = "offline"): LogStreamState {
  return {
    logs: [],
    diagnostics: [],
    healthSummary: { totalStreams: 0, activeStreams: 0, retryingStreams: 0, failedStreams: 0 },
    status,
    streamError: null,
    streamId: null,
    lastSequence: 0,
  };
}

export function applyNormalizedLogFrame(
  prev: LogStreamState,
  data: NormalizedLogFrame,
  fallbackName: string,
  fallbackNamespace: string,
  maxLogs: number,
  seenSequences: Set<string>
): LogStreamState {
  const activeStreamId = data.streamId || prev.streamId;

  if (data.type === "diagnostic") {
    const diag: StreamDiagnostic = {
      source: data.source || "system",
      namespace: data.namespace,
      pod: data.pod,
      container: data.container,
      status: (data.status as StreamDiagnosticStatus) || "active",
      code: data.code,
      reason: data.reason || "",
      timestamp: data.timestamp || new Date().toISOString(),
      retryCount: data.retryCount,
      nextRetryMs: data.nextRetryMs,
    };
    const idx = prev.diagnostics.findIndex((d) => d.source === diag.source);
    const diagnostics =
      idx >= 0
        ? prev.diagnostics.map((d, i) => (i === idx ? diag : d))
        : [...prev.diagnostics, diag];
    return { ...prev, streamId: activeStreamId, diagnostics };
  }

  if (data.type === "status") {
    return {
      ...prev,
      streamId: activeStreamId,
      healthSummary: {
        totalStreams: data.totalStreams || 0,
        activeStreams: data.activeStreams || 0,
        retryingStreams: data.retryingStreams || 0,
        failedStreams: data.failedStreams || 0,
        scope: data.scope,
      },
    };
  }

  if (data.type === "end") {
    return {
      ...prev,
      streamId: activeStreamId,
      status: "ended",
    };
  }

  if (data.type === "cancel") {
    return {
      ...prev,
      streamId: activeStreamId,
      status: "offline",
    };
  }

  if (data.type === "error") {
    const isDisconnected = DISCONNECT_ERROR_CODES.has(data.code || "") || data.status === "disconnected" || data.status === "interrupted";
    const errText = data.reason || data.message || "Log stream error";
    const diag: StreamDiagnostic = {
      source: data.source || "system",
      namespace: data.namespace,
      pod: data.pod,
      container: data.container,
      status: isDisconnected ? "disconnected" : "failed",
      code: data.code,
      reason: errText,
      timestamp: data.timestamp || new Date().toISOString(),
    };
    const idx = prev.diagnostics.findIndex((d) => d.source === diag.source);
    const diagnostics =
      idx >= 0
        ? prev.diagnostics.map((d, i) => (i === idx ? diag : d))
        : [...prev.diagnostics, diag];

    return {
      ...prev,
      streamId: activeStreamId,
      status: isDisconnected ? "disconnected" : "error",
      streamError: errText,
      diagnostics,
    };
  }

  if (data.type === "log" || (data.message && !data.status)) {
    const message = data.message || "";
    let nextDiagnostics = prev.diagnostics;
    let nextSeq = prev.lastSequence;

    if (data.sequence && data.sequence > 0) {
      const dedupeKey = `${activeStreamId || "default"}:${data.sequence}`;
      if (seenSequences.has(dedupeKey)) {
        return prev;
      }
      seenSequences.add(dedupeKey);

      if (prev.lastSequence > 0 && data.sequence > prev.lastSequence + 1) {
        const missed = data.sequence - prev.lastSequence - 1;
        const gapDiag: StreamDiagnostic = {
          source: "sequence-monitor",
          namespace: data.namespace || fallbackNamespace,
          pod: data.pod || fallbackName,
          container: data.container,
          status: "backpressure",
          code: "sequence_gap",
          reason: `Detected sequence gap: ${missed} frame(s) missed between #${prev.lastSequence} and #${data.sequence}`,
          timestamp: data.timestamp || new Date().toISOString(),
        };
        const idx = nextDiagnostics.findIndex((d) => d.source === gapDiag.source);
        nextDiagnostics =
          idx >= 0
            ? nextDiagnostics.map((d, i) => (i === idx ? gapDiag : d))
            : [...nextDiagnostics, gapDiag];
      }
      if (data.sequence > nextSeq) {
        nextSeq = data.sequence;
      }
    }

    const fallbackLvl = (data.level as LogLevel) || "INFO";
    const parsed = parseLogPayload(message, fallbackLvl);
    const newLine: PodLogLine = {
      id: data.sequence
        ? `log-${activeStreamId || "s"}-${data.sequence}`
        : `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      streamId: activeStreamId || undefined,
      sequence: data.sequence,
      timestamp: data.timestamp || parsed.timestamp || new Date().toISOString(),
      level: parsed.level || fallbackLvl,
      message: parsed.message || message,
      podName: data.pod || data.source || fallbackName,
      namespace: data.namespace || fallbackNamespace,
      container: data.container || "main",
      stream: data.stream || "stdout",
      source: data.source || fallbackName,
      parsed,
    };

    return {
      ...prev,
      streamId: activeStreamId,
      lastSequence: nextSeq,
      diagnostics: nextDiagnostics,
      logs: [...prev.logs.slice(-(maxLogs - 1)), newLine],
    };
  }

  return prev;
}

