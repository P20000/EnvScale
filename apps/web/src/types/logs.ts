import type { ParsedLogPayload } from "../utils/logParser";

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface PodLogLine {
  id: string;
  streamId?: string;
  sequence?: number;
  timestamp: string;
  level: LogLevel;
  message: string;
  podName?: string;
  namespace?: string;
  container?: string;
  stream?: "stdout" | "stderr";
  source?: string;
  parsed?: ParsedLogPayload;
}

export type LogStreamStatus =
  | "connecting"
  | "streaming"
  | "paused"
  | "ended"
  | "disconnected"
  | "offline"
  | "error";

export type StreamDiagnosticStatus =
  | "active"
  | "retrying"
  | "backoff"
  | "failed"
  | "terminated"
  | "permission_denied"
  | "backpressure"
  | "interrupted"
  | "disconnected"
  | "unsupported"
  | "restarted"
  | "truncated";

export interface StreamDiagnostic {
  source: string;
  namespace?: string;
  pod?: string;
  container?: string;
  status: StreamDiagnosticStatus;
  code?: string;
  reason: string;
  timestamp: string;
  retryCount?: number;
  nextRetryMs?: number;
}

export interface StreamHealthSummary {
  totalStreams: number;
  activeStreams: number;
  retryingStreams: number;
  failedStreams: number;
  scope?: string;
}

export interface NormalizedLogFrame {
  type: "log" | "diagnostic" | "status" | "end" | "error" | "cancel";
  streamId?: string;
  clusterId?: string;
  sessionId?: string;
  sequence?: number;
  timestamp?: string;
  namespace?: string;
  pod?: string;
  container?: string;
  source?: string;
  stream?: "stdout" | "stderr";
  kind?: string;
  level?: LogLevel;
  message?: string;
  status?: string;
  code?: string;
  reason?: string;
  retryCount?: number;
  nextRetryMs?: number;
  totalStreams?: number;
  activeStreams?: number;
  retryingStreams?: number;
  failedStreams?: number;
  scope?: string;
}
