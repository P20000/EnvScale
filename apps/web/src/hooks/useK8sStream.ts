import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { useTopologyStore } from "../store/useTopologyStore";

export type WsConnectionStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR";

export interface WsTopologyMessage {
  type?:
    | "EVENT_TOPOLOGY_SNAPSHOT"
    | "EVENT_POD_ADDED"
    | "EVENT_POD_MODIFIED"
    | "EVENT_POD_DELETED"
    | "EVENT_POD_STATUS_CHANGED"
    | "EVENT_NODE_ADDED"
    | "EVENT_NODE_MODIFIED"
    | "EVENT_NODE_DELETED"
    | "EVENT_NODE_MUTATED"
    | "EVENT_SERVICE_ADDED"
    | "EVENT_SERVICE_MODIFIED"
    | "EVENT_SERVICE_DELETED"
    | "EVENT_SERVICE_MUTATED"
    | "EVENT_LOG_LINE"
    | "EVENT_ALERT_TRIGGERED"
    | "EVENT_HEARTBEAT"
    | string;
  event?: string;
  payload?: {
    nodes?: Node[];
    edges?: Edge[];
    node?: Node;
    nodeId?: string;
    pod?: Node;
    podId?: string;
    service?: Node;
    serviceId?: string;
    cluster?: string;
    metrics?: Record<string, unknown>;
    [key: string]: unknown;
  };
  data?: unknown;
  clusterId?: string;
  timestamp?: string;
  latencyMs?: number;
}

const DEFAULT_WS_URL = "ws://localhost:8080/ws/k8s";

export function useK8sStream(
  onMessageReceived?: (msg: WsTopologyMessage) => void,
  urlOverride?: string,
  clusterId?: string
) {
  const [status, setStatus] = useState<WsConnectionStatus>("DISCONNECTED");
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPingTimeRef = useRef<number>(0);
  const isComponentMounted = useRef<boolean>(true);
  const connectRef = useRef<() => void>(() => {});

  const activeCluster = useTopologyStore((state) => state.activeCluster);
  const targetClusterId = clusterId || activeCluster || "minikube-prod";

  const wsUrl = useMemo(() => {
    const rawUrl = urlOverride || import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;
    let fullUrl = rawUrl;
    if (rawUrl.startsWith("/")) {
      const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = typeof window !== "undefined" ? window.location.host : "localhost:8080";
      fullUrl = `${protocol}//${host}${rawUrl}`;
    }
    try {
      const url = new URL(fullUrl);
      url.searchParams.set("clusterId", targetClusterId);
      return url.toString();
    } catch {
      const hasQuery = fullUrl.includes("?");
      return `${fullUrl}${hasQuery ? "&" : "?"}clusterId=${encodeURIComponent(targetClusterId)}`;
    }
  }, [urlOverride, targetClusterId]);

  const onMessageReceivedRef = useRef(onMessageReceived);
  useEffect(() => {
    onMessageReceivedRef.current = onMessageReceived;
  }, [onMessageReceived]);

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    setStatus("CONNECTING");

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!isComponentMounted.current) return;
        setStatus("CONNECTED");
        lastPingTimeRef.current = performance.now();
        try {
          socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
        } catch {
          // Send ping frame
        }

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            lastPingTimeRef.current = performance.now();
            try {
              wsRef.current.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
            } catch {
              // Send ping frame
            }
          }
        }, 5000);
      };

      socket.onmessage = (event: MessageEvent) => {
        if (!isComponentMounted.current) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed) {
            const eventType = String(parsed.event || parsed.type || "");
            const eventPayload = parsed.data !== undefined ? parsed.data : parsed.payload;

            let measuredLatency = 0;
            if (eventType === "pong" || eventType === "EVENT_HEARTBEAT" || parsed.type === "pong") {
              if (lastPingTimeRef.current > 0) {
                measuredLatency = Math.max(1, Math.round(performance.now() - lastPingTimeRef.current));
              }
            } else if (parsed.timestamp && typeof parsed.timestamp === "string") {
              const msgTime = new Date(parsed.timestamp).getTime();
              if (!isNaN(msgTime) && msgTime > 0) {
                measuredLatency = Math.max(1, Math.round(Date.now() - msgTime));
              }
            } else if (lastPingTimeRef.current > 0) {
              measuredLatency = Math.max(1, Math.round(performance.now() - lastPingTimeRef.current));
            }

            if (measuredLatency > 0) {
              setLatencyMs(measuredLatency);
            }

            const normalizedMsg: WsTopologyMessage = {
              type: eventType,
              event: eventType,
              payload: eventPayload as WsTopologyMessage["payload"],
              data: eventPayload,
              clusterId: typeof parsed.clusterId === "string" ? parsed.clusterId : undefined,
              timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
              latencyMs: measuredLatency || undefined,
            };

            if (eventType) {
              onMessageReceivedRef.current?.(normalizedMsg);
            }
          }
        } catch {
          // Safe JSON parsing
        }
      };

      socket.onerror = () => {
        if (!isComponentMounted.current) return;
        setStatus("ERROR");
        setLatencyMs(0);
      };

      socket.onclose = () => {
        if (!isComponentMounted.current) return;
        setStatus("DISCONNECTED");
        setLatencyMs(0);
        wsRef.current = null;
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          if (isComponentMounted.current) {
            connectRef.current();
          }
        }, 4000);
      };
    } catch {
      if (!isComponentMounted.current) return;
      setStatus("DISCONNECTED");
      setLatencyMs(0);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isComponentMounted.current) {
          connectRef.current();
        }
      }, 5000);
    }
  }, [wsUrl]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    isComponentMounted.current = true;
    connect();

    return () => {
      isComponentMounted.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    status,
    latencyMs,
    reconnect: connect,
  };
}
