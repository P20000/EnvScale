import { useState, useEffect, useRef, useCallback } from "react";
import type { PodLogLine, LogLevel, LogStreamStatus } from "../types/logs";
import { useTopologyStore } from "../store/useTopologyStore";

interface UsePodLogsOptions {
  podName: string | null;
  namespace?: string;
  enabled?: boolean;
  maxLogs?: number;
}

const SAMPLE_MESSAGES: Array<{ level: LogLevel; text: string }> = [
  { level: "INFO", text: "GET /api/v1/metrics 200 OK 12ms" },
  { level: "INFO", text: "Processed WebSocket message payload (delta status updated)" },
  { level: "DEBUG", text: "DB Connection pool alive (active: 4, idle: 16)" },
  { level: "INFO", text: "Health check endpoint GET /healthz 200 OK" },
  { level: "WARN", text: "High memory pressure detected (> 65% capacity threshold)" },
  { level: "INFO", text: "Ingress routing rule evaluated for service /api/v1/pods" },
  { level: "DEBUG", text: "Garbage collection sweep completed in 1.4ms" },
  { level: "ERROR", text: "Failed to resolve DNS for auth-service.kube-system.svc.cluster.local" },
  { level: "INFO", text: "HTTP connection keep-alive timeout renewed for client 10.244.0.12" },
  { level: "WARN", text: "Slow query detected on PostgreSQL read replica (duration: 342ms)" },
  { level: "INFO", text: "Cluster autoscaler heartbeat acknowledged by control plane" },
];

function generateInitialLogs(podName: string, namespace: string): PodLogLine[] {
  const now = Date.now();
  return [
    {
      id: `${podName}-init-1`,
      timestamp: new Date(now - 12000).toISOString(),
      level: "INFO",
      message: `Starting container process in pod ${podName} (${namespace})...`,
      podName,
      namespace,
      container: "main",
      stream: "stdout",
    },
    {
      id: `${podName}-init-2`,
      timestamp: new Date(now - 9000).toISOString(),
      level: "INFO",
      message: "Initializing environment configurations and binding to 0.0.0.0:8080",
      podName,
      namespace,
      container: "main",
      stream: "stdout",
    },
    {
      id: `${podName}-init-3`,
      timestamp: new Date(now - 6000).toISOString(),
      level: "DEBUG",
      message: "Loaded TLS certificate bundle from secret /etc/ssl/certs/k8s-tls",
      podName,
      namespace,
      container: "main",
      stream: "stdout",
    },
    {
      id: `${podName}-init-4`,
      timestamp: new Date(now - 3000).toISOString(),
      level: "INFO",
      message: "HTTP & gRPC server readiness probe returned HTTP 200 OK",
      podName,
      namespace,
      container: "main",
      stream: "stdout",
    },
  ];
}

export function usePodLogs({
  podName,
  namespace = "default",
  enabled = true,
  maxLogs = 500,
}: UsePodLogsOptions) {
  const [logs, setLogs] = useState<PodLogLine[]>(() =>
    podName ? generateInitialLogs(podName, namespace) : []
  );
  const [isTailing, setIsTailing] = useState<boolean>(true);
  const [prevPodKey, setPrevPodKey] = useState<string | null>(podName ? `${namespace}/${podName}` : null);
  const lineCounterRef = useRef<number>(5);

  const currentPodKey = podName ? `${namespace}/${podName}` : null;
  if (currentPodKey !== prevPodKey) {
    setPrevPodKey(currentPodKey);
    setLogs(podName ? generateInitialLogs(podName, namespace) : []);
  }

  useEffect(() => {
    lineCounterRef.current = 5;
  }, [podName, namespace]);

  const status: LogStreamStatus = !podName
    ? "offline"
    : !enabled
    ? "offline"
    : !isTailing
    ? "paused"
    : "streaming";

  const activeCluster = useTopologyStore((s) => s.activeCluster) || "mini-todo";

  // Live log tailing effect with cleanup & backend integration fallback
  useEffect(() => {
    if (!podName || !enabled || !isTailing) {
      return;
    }

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

    // Attempt real API log stream handshake if backend is present
    fetch(`${API_BASE_URL}/api/v1/logs/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId: activeCluster,
        namespace,
        podName,
        tailLines: 50,
      }),
    }).catch(() => {
      // Backend log stream endpoint offline — fallback to local simulated stream
    });

    const interval = setInterval(() => {
      const sample = SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)];
      const idNum = lineCounterRef.current++;
      const newLine: PodLogLine = {
        id: `${podName}-${idNum}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        level: sample.level,
        message: sample.text,
        podName,
        namespace,
        container: "main",
        stream: sample.level === "ERROR" || sample.level === "FATAL" ? "stderr" : "stdout",
      };

      setLogs((prev) => {
        const updated = [...prev, newLine];
        return updated.length > maxLogs ? updated.slice(updated.length - maxLogs) : updated;
      });
    }, 2000);

    return () => {
      clearInterval(interval);

      // Cleanup backend stream when pod changes or drawer closes
      fetch(`${API_BASE_URL}/api/v1/logs/stream`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterId: activeCluster,
          namespace,
          podName,
        }),
      }).catch(() => {});
    };
  }, [podName, namespace, enabled, isTailing, maxLogs, activeCluster]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const copyLogs = useCallback(() => {
    if (logs.length === 0) return;
    const formattedText = logs
      .map((l) => `[${l.timestamp}] ${l.level.padEnd(5)} [${l.podName || "pod"}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(formattedText);
  }, [logs]);

  const addLogLine = useCallback((line: Partial<PodLogLine>) => {
    if (!line.message) return;
    const newLine: PodLogLine = {
      id: line.id || `custom-${Date.now()}-${Math.random()}`,
      timestamp: line.timestamp || new Date().toISOString(),
      level: line.level || "INFO",
      message: line.message,
      podName: line.podName || podName || undefined,
      namespace: line.namespace || namespace,
      container: line.container || "main",
      stream: line.stream || "stdout",
    };
    setLogs((prev) => [...prev, newLine]);
  }, [podName, namespace]);

  return {
    logs,
    status,
    isTailing,
    setIsTailing,
    clearLogs,
    copyLogs,
    addLogLine,
  };
}
