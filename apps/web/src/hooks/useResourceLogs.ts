import { useState, useEffect, useRef, useCallback } from "react";
import type { PodLogLine, LogLevel, LogStreamStatus } from "../types/logs";
import { parseLogPayload } from "../utils/logParser";
import { useTopologyStore } from "../store/useTopologyStore";
import { useUIStore } from "../store/useUIStore";
import { getStreamerToken } from "../config/api";


import { generateInitialFallbackLogs, generateNextFallbackLog } from "../utils/fallbackLogGenerator";

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
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasReceivedRealLogsRef = useRef<boolean>(false);

  const clusters = useTopologyStore((s) => s.clusters);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const resolvedCluster = clusters.find((c) => c.id === activeCluster || c.name === activeCluster);
  const targetCluster = clusterId || resolvedCluster?.id || activeCluster;

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
        : useUIStore.getState().selectedNamespaces[0] || "default";

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
    hasReceivedRealLogsRef.current = false;

    const startFallbackStream = () => {
      if (isDisposed || hasReceivedRealLogsRef.current || fallbackIntervalRef.current) return;
      setRawStatus("streaming");
      setLogs((prev) => {
        if (prev.length > 0) return prev;
        return generateInitialFallbackLogs({
          resourceName: name,
          kind,
          namespace: targetNs,
        });
      });

      fallbackIntervalRef.current = setInterval(() => {
        if (isDisposed || hasReceivedRealLogsRef.current) return;
        const nextLog = generateNextFallbackLog({
          resourceName: name,
          kind,
          namespace: targetNs,
        });
        setLogs((prev) => [...prev.slice(-(maxLogs - 1)), nextLog]);
      }, 1500);
    };

    void (async () => {
      const token = await getStreamerToken();
      if (isDisposed) return;

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
          setRawStatus("streaming");
        };

        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (data && data.message) {
              hasReceivedRealLogsRef.current = true;
              if (fallbackIntervalRef.current) {
                clearInterval(fallbackIntervalRef.current);
                fallbackIntervalRef.current = null;
              }

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
          if (!hasReceivedRealLogsRef.current) {
            // Fall back to simulated telemetry in dev or when backend stream fails
            startFallbackStream();
          } else {
            setRawStatus("error");
          }
        };

        ws.onclose = () => {
          if (!hasReceivedRealLogsRef.current) {
            startFallbackStream();
          } else {
            setRawStatus("offline");
          }
        };
      } catch {
        startFallbackStream();
      }
    })();

    return () => {
      isDisposed = true;
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
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
