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
}

export type LogStreamStatus = "connecting" | "streaming" | "paused" | "offline" | "error";
