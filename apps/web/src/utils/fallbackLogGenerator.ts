import type { PodLogLine, LogLevel } from "../types/logs";
import { parseLogPayload } from "./logParser";

interface FallbackLogOptions {
  resourceName: string;
  kind?: string;
  namespace?: string;
}

const SAMPLE_ENDPOINTS = [
  { path: "/healthz", method: "GET", status: 200, duration: "1.2ms", level: "INFO" as LogLevel },
  { path: "/api/v1/status", method: "GET", status: 200, duration: "4.8ms", level: "INFO" as LogLevel },
  { path: "/metrics", method: "GET", status: 200, duration: "2.1ms", level: "DEBUG" as LogLevel },
  { path: "/api/v1/query", method: "POST", status: 200, duration: "24.5ms", level: "INFO" as LogLevel },
  { path: "/api/v1/sync", method: "POST", status: 200, duration: "18.3ms", level: "INFO" as LogLevel },
  { path: "/api/v1/cache/refresh", method: "POST", status: 304, duration: "0.8ms", level: "DEBUG" as LogLevel },
  { path: "/api/v1/tasks", method: "GET", status: 200, duration: "9.2ms", level: "INFO" as LogLevel },
  { path: "/internal/heartbeat", method: "GET", status: 200, duration: "0.4ms", level: "TRACE" as LogLevel },
];

export function generateInitialFallbackLogs({
  resourceName,
  kind = "Pod",
  namespace = "default",
}: FallbackLogOptions): PodLogLine[] {
  const now = Date.now();
  const logs: PodLogLine[] = [];

  const rawLines: Array<{ offsetMs: number; level: LogLevel; msg: string }> = [
    { offsetMs: 30000, level: "INFO", msg: `Starting container runtime for ${kind}/${resourceName} in namespace ${namespace}` },
    { offsetMs: 28000, level: "INFO", msg: `Mounted volume /var/run/secrets/kubernetes.io/serviceaccount` },
    { offsetMs: 25000, level: "INFO", msg: `Loaded configuration profile: activeProfiles=[local,development]` },
    { offsetMs: 22000, level: "DEBUG", msg: `Initialized TCP connection pool (min=2, max=20, timeout=5000ms)` },
    { offsetMs: 20000, level: "INFO", msg: `HTTP server listening on 0.0.0.0:8080 (ready for ingress traffic)` },
    { offsetMs: 16000, level: "INFO", msg: `10.244.0.1 - - "GET /healthz HTTP/1.1" 200 48 "kube-probe/1.30"` },
    { offsetMs: 12000, level: "INFO", msg: `10.244.0.1 - - "GET /api/v1/status HTTP/1.1" 200 128 "-" "Mozilla/5.0"` },
    { offsetMs: 8000, level: "DEBUG", msg: `Garbage collector freed 24.2MB heap memory in 1.4ms` },
    { offsetMs: 4000, level: "INFO", msg: `10.244.0.1 - - "GET /healthz HTTP/1.1" 200 48 "kube-probe/1.30"` },
  ];

  for (const item of rawLines) {
    const timestamp = new Date(now - item.offsetMs).toISOString();
    const parsed = parseLogPayload(item.msg, item.level);
    logs.push({
      id: `fallback-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      level: item.level,
      message: item.msg,
      podName: resourceName,
      namespace,
      container: "main",
      stream: "stdout",
      source: resourceName,
      parsed,
    });
  }

  return logs;
}

export function generateNextFallbackLog({
  resourceName,
  kind = "Pod",
  namespace = "default",
}: FallbackLogOptions): PodLogLine {
  const sample = SAMPLE_ENDPOINTS[Math.floor(Math.random() * SAMPLE_ENDPOINTS.length)];
  const isErr = Math.random() < 0.05; // 5% chance of warning/retry
  const level: LogLevel = isErr ? "WARN" : sample.level;
  const status = isErr ? 499 : sample.status;

  const msg = isErr
    ? `Client connection closed before response finalized for ${sample.path} (${sample.duration})`
    : `10.244.0.1 - - "${sample.method} ${sample.path} HTTP/1.1" ${status} 96 "-" "EnvScale-Client/1.0" (${sample.duration})`;

  const timestamp = new Date().toISOString();
  const parsed = parseLogPayload(msg, level);

  return {
    id: `fallback-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    level,
    message: msg,
    podName: resourceName,
    namespace,
    container: "main",
    stream: "stdout",
    source: `${resourceName} (${kind})`,
    parsed,
  };
}
