import { useState, useEffect, useRef, useCallback } from "react";
import type { PodLogLine, LogLevel, LogStreamStatus } from "../types/logs";
import { parseLogPayload } from "../utils/logParser";
import { useTopologyStore } from "../store/useTopologyStore";

interface UseResourceLogsOptions {
  name: string | null;
  kind?: string;
  namespace?: string;
  clusterId?: string;
  enabled?: boolean;
  maxLogs?: number;
}

export function useResourceLogs({
  name,
  kind = "Pod",
  namespace = "default",
  clusterId,
  enabled = true,
  maxLogs = 500,
}: UseResourceLogsOptions) {
  const [logs, setLogs] = useState<PodLogLine[]>([]);
  const [isTailing, setIsTailing] = useState<boolean>(true);
  const [rawStatus, setRawStatus] = useState<LogStreamStatus>("offline");

  const status: LogStreamStatus = !name || !enabled ? "offline" : rawStatus;

  const wsRef = useRef<WebSocket | null>(null);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const targetCluster = clusterId || activeCluster;

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const copyLogs = useCallback(() => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.level}] ${l.source ? `(${l.source}) ` : ""}${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [logs]);

  useEffect(() => {
    if (!name || !enabled || !targetCluster) {
      return;
    }

    const targetNs =
      namespace && namespace !== "default"
        ? namespace
        : useTopologyStore.getState().selectedNamespaces[0] || "default";

    const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8080";
    const url = `${WS_BASE_URL}/api/v1/stream/logs?clusterId=${encodeURIComponent(
      targetCluster
    )}&namespace=${encodeURIComponent(targetNs)}&kind=${encodeURIComponent(
      kind
    )}&name=${encodeURIComponent(name)}&tailLines=100`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setRawStatus("streaming");
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data && data.message) {
          const fallbackLvl = (data.level as LogLevel) || "INFO";
          const parsed = parseLogPayload(data.message, fallbackLvl);

          const newLogLine: PodLogLine = {
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: data.timestamp || parsed.timestamp || new Date().toISOString(),
            level: parsed.level || fallbackLvl,
            message: parsed.message || data.message,
            podName: data.source || name,
            namespace: targetNs,
            container: "main",
            stream: "stdout",
            source: data.source || name,
            parsed,
          };

          if (parsed.level === "ERROR" || parsed.level === "FATAL") {
            const src = data.source || name || "workload";
            useTopologyStore
              .getState()
              .addNotification(
                `Error Log Detected in ${src}`,
                parsed.message,
                "CRITICAL"
              );
          }

          setLogs((prev) => [...prev.slice(-(maxLogs - 1)), newLogLine]);
        }
      } catch {
        // Ignored
      }
    };

    ws.onerror = () => {
      setRawStatus("error");
    };

    ws.onclose = () => {
      setRawStatus("offline");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [name, kind, namespace, targetCluster, enabled, maxLogs]);

  return {
    logs,
    status,
    isTailing,
    setIsTailing,
    clearLogs,
    copyLogs,
  };
}
