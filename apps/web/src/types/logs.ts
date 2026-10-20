import type { ParsedLogPayload } from "../utils/logParser";

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface PodLogLine {
  id: string;
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

export type LogStreamStatus = "connecting" | "streaming" | "paused" | "offline" | "error";
