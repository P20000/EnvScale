import { useState, useEffect, useRef, useCallback } from "react";
import type { PodLogLine, LogLevel, LogStreamStatus, StreamDiagnostic, StreamHealthSummary } from "../types/logs";
import { parseLogPayload } from "../utils/logParser";
import { useTopologyStore } from "../store/useTopologyStore";
import { useUIStore } from "../store/useUIStore";
import { getStreamerToken } from "../config/api";

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
  maxLogs = 1000,
}: UseResourceLogsOptions) {
  const [logs, setLogs] = useState<PodLogLine[]>([]);
  const [diagnostics, setDiagnostics] = useState<StreamDiagnostic[]>([]);
  const [healthSummary, setHealthSummary] = useState<StreamHealthSummary>({
    totalStreams: 0,
    activeStreams: 0,
    retryingStreams: 0,
    failedStreams: 0,
  });
  const [isTailing, setIsTailing] = useState<boolean>(true);
  const [rawStatus, setRawStatus] = useState<LogStreamStatus>("offline");

  const clusters = useTopologyStore((s) => s.clusters);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const resolvedCluster = clusters.find((c) => c.id === activeCluster || c.name === activeCluster);
  const targetCluster = clusterId || resolvedCluster?.id || activeCluster;

  const isTargetValid = Boolean(name && enabled && targetCluster);
  const status: LogStreamStatus = !isTargetValid ? "offline" : rawStatus;

  const wsRef = useRef<WebSocket | null>(null);

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

    const isAllNs = namespace === "all" || namespace === "_all" || namespace === "";
    const targetNs = isAllNs
      ? "all"
      : namespace || useUIStore.getState().selectedNamespaces[0] || "default";

    const isViteDev =
      typeof window !== "undefined" &&
      (window.location.port === "5173" || window.location.port === "5174");

    const getWsBaseUrl = () => {
      if (import.meta.env.VITE_WS_BASE_URL) return import.meta.env.VITE_WS_BASE_URL;
      if (import.meta.env.VITE_WS_URL) {
        try {
          const u = new URL(import.meta.env.VITE_WS_URL);
          return `${u.protocol}//${u.host}`;
        } catch {
          // ignore parsing error
        }
      }
      if (typeof window !== "undefined") {
        if (isViteDev) {
          return "ws://localhost:8080";
        }
        return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      }
      return "ws://localhost:8080";
    };

    const WS_BASE_URL = getWsBaseUrl();
    let isDisposed = false;
    let ws: WebSocket | null = null;

    void (async () => {
      const token = await getStreamerToken();
      if (isDisposed) return;

      setLogs([]);
      setDiagnostics([]);
      setHealthSummary({ totalStreams: 0, activeStreams: 0, retryingStreams: 0, failedStreams: 0 });
      setRawStatus("connecting");

      let url = `${WS_BASE_URL}/api/v1/stream/logs?clusterId=${encodeURIComponent(
        targetCluster
      )}&namespace=${encodeURIComponent(targetNs)}&kind=${encodeURIComponent(
        kind
      )}&name=${encodeURIComponent(name)}&tailLines=100`;

      if (token) {
        url += `&token=${encodeURIComponent(token)}`;
      }

      try {
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isDisposed) {
            setRawStatus("streaming");
          }
        };

        ws.onmessage = (evt) => {
          if (isDisposed) return;
          try {
            const data = JSON.parse(evt.data);
            if (!data) return;

            // 1. Separate Stream Diagnostic events from workload logs
            if (data.type === "diagnostic") {
              const diag: StreamDiagnostic = {
                source: data.source || "system",
                namespace: data.namespace,
                pod: data.pod,
                container: data.container,
                status: data.status || "active",
                reason: data.reason || "",
                timestamp: data.timestamp || new Date().toISOString(),
                retryCount: data.retryCount,
                nextRetryMs: data.nextRetryMs,
              };
              setDiagnostics((prev) => {
                const idx = prev.findIndex((d) => d.source === diag.source);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = diag;
                  return copy;
                }
                return [...prev, diag];
              });
              return;
            }

            // 2. Stream Aggregate Health Status
            if (data.type === "status") {
              setHealthSummary({
                totalStreams: data.totalStreams || 0,
                activeStreams: data.activeStreams || 0,
                retryingStreams: data.retryingStreams || 0,
                failedStreams: data.failedStreams || 0,
                scope: data.scope,
              });
              return;
            }

            // 3. Genuine Workload Container Log Line
            if (data.type === "log" || (data.message && !data.status)) {
              const fallbackLvl = (data.level as LogLevel) || "INFO";
              const parsed = parseLogPayload(data.message, fallbackLvl);

              const newLogLine: PodLogLine = {
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: data.timestamp || parsed.timestamp || new Date().toISOString(),
                level: parsed.level || fallbackLvl,
                message: parsed.message || data.message,
                podName: data.pod || data.source || name,
                namespace: data.namespace || targetNs,
                container: data.container || "main",
                stream: data.stream || "stdout",
                source: data.source || name,
                parsed,
              };

              setLogs((prev) => [...prev.slice(-(maxLogs - 1)), newLogLine]);
            }
          } catch {
            // Ignored malformed message
          }
        };

        ws.onerror = () => {
          if (!isDisposed) {
            setRawStatus("error");
          }
        };

        ws.onclose = () => {
          if (!isDisposed) {
            setRawStatus("offline");
          }
        };
      } catch {
        if (!isDisposed) {
          setRawStatus("error");
        }
      }
    })();

    return () => {
      isDisposed = true;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
    };
  }, [name, kind, namespace, targetCluster, enabled, maxLogs]);

  return {
    logs,
    diagnostics,
    healthSummary,
    status,
    isTailing,
    setIsTailing,
    clearLogs,
    copyLogs,
  };
}
