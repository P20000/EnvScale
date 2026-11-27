import { useState, useEffect, useRef, useCallback } from "react";
import type {
  LogStreamStatus,
  NormalizedLogFrame,
  StreamDiagnostic,
  StreamHealthSummary,
  PodLogLine,
} from "../types/logs";
import { useTopologyStore } from "../store/useTopologyStore";
import { useUIStore } from "../store/useUIStore";
import { getStreamerToken } from "../config/api";
import {
  applyNormalizedLogFrame,
  buildLogStreamWebSocketUrl,
  createInitialLogStreamState,
  type LogStreamState,
} from "../utils/logStreamHelpers";

interface UseResourceLogsOptions {
  name: string | null;
  kind?: string;
  namespace?: string;
  clusterId?: string;
  container?: string;
  follow?: boolean;
  previous?: boolean;
  timestamps?: boolean;
  tailLines?: number;
  sinceSeconds?: number;
  enabled?: boolean;
  maxLogs?: number;
}

export function useResourceLogs({
  name,
  kind = "Pod",
  namespace = "default",
  clusterId,
  container,
  follow = true,
  previous = false,
  timestamps = true,
  tailLines = 100,
  sinceSeconds,
  enabled = true,
  maxLogs = 1000,
}: UseResourceLogsOptions) {
  const [streamState, setStreamState] = useState<LogStreamState>(() => createInitialLogStreamState("offline"));
  const [isTailing, setIsTailing] = useState<boolean>(true);

  const clusters = useTopologyStore((s) => s.clusters);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const resolvedCluster = clusters.find((c) => c.id === activeCluster || c.name === activeCluster);
  const targetCluster = clusterId || resolvedCluster?.id || activeCluster;

  const isTargetValid = Boolean(name && enabled && targetCluster);
  const status: LogStreamStatus = !isTargetValid ? "offline" : streamState.status;

  const wsRef = useRef<WebSocket | null>(null);
  const terminalStatusRef = useRef<LogStreamStatus | null>(null);
  const seenSequencesRef = useRef<Set<string>>(new Set());

  const clearLogs = useCallback(() => {
    seenSequencesRef.current.clear();
    setStreamState((prev) => ({ ...prev, logs: [] }));
  }, []);

  const copyLogs = useCallback(() => {
    const text = streamState.logs
      .map((l) => `[${l.timestamp}] [${l.level}] ${l.source ? `(${l.source}) ` : ""}${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [streamState.logs]);

  const cancelStream = useCallback(() => {
    const activeWs = wsRef.current;
    terminalStatusRef.current = "offline";
    if (activeWs) {
      if (activeWs.readyState === WebSocket.OPEN) {
        try {
          activeWs.send(JSON.stringify({ type: "cancel" }));
        } catch {
          // ignore send errors during teardown
        }
        activeWs.close();
      } else if (activeWs.readyState === WebSocket.CONNECTING) {
        activeWs.close();
      }
      wsRef.current = null;
    }
    setStreamState((prev) => ({ ...prev, status: "offline" }));
  }, []);

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
    terminalStatusRef.current = null;
    seenSequencesRef.current.clear();

    void (async () => {
      const token = await getStreamerToken();
      if (isDisposed) return;

      setStreamState(createInitialLogStreamState("connecting"));

      const url = buildLogStreamWebSocketUrl({
        wsBaseUrl: WS_BASE_URL,
        clusterId: targetCluster,
        namespace: targetNs,
        kind,
        name,
        container,
        tailLines,
        follow,
        previous,
        timestamps,
        sinceSeconds,
        token,
      });

      try {
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isDisposed) {
            setStreamState((prev) => ({ ...prev, status: "streaming" }));
          }
        };

        ws.onmessage = (evt) => {
          if (isDisposed) return;
          try {
            const data = JSON.parse(evt.data) as NormalizedLogFrame;
            if (!data) return;

            setStreamState((prev) => {
              const next = applyNormalizedLogFrame(
                prev,
                data,
                name,
                targetNs,
                maxLogs,
                seenSequencesRef.current
              );
              if (next.status === "ended" || next.status === "error" || next.status === "disconnected") {
                terminalStatusRef.current = next.status;
              }
              return next;
            });
          } catch {
            // Ignored malformed message
          }
        };

        ws.onerror = () => {
          if (!isDisposed && !terminalStatusRef.current) {
            terminalStatusRef.current = "error";
            setStreamState((prev) => ({
              ...prev,
              status: "error",
              streamError: prev.streamError || "WebSocket connection failed",
            }));
          }
        };

        ws.onclose = () => {
          if (!isDisposed) {
            const preserved = terminalStatusRef.current;
            setStreamState((prev) => ({
              ...prev,
              status: preserved || "offline",
            }));
          }
        };
      } catch {
        if (!isDisposed) {
          terminalStatusRef.current = "error";
          setStreamState((prev) => ({
            ...prev,
            status: "error",
            streamError: "Failed to initialize log stream connection",
          }));
        }
      }
    })();

    return () => {
      isDisposed = true;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "cancel" }));
          } catch {
            // ignore cancellation send errors during teardown
          }
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [name, kind, namespace, targetCluster, container, follow, previous, timestamps, tailLines, sinceSeconds, enabled, maxLogs]);

  return {
    logs: streamState.logs as PodLogLine[],
    diagnostics: streamState.diagnostics as StreamDiagnostic[],
    healthSummary: streamState.healthSummary as StreamHealthSummary,
    status,
    streamError: streamState.streamError,
    streamId: streamState.streamId,
    isTailing,
    setIsTailing,
    clearLogs,
    copyLogs,
    cancelStream,
  };
}
