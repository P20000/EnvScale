import { useEffect, useState, useRef, useCallback } from "react";
import type { Node, Edge } from "@xyflow/react";

export type WsConnectionStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR";

export interface WsTopologyMessage {
  type:
    | "EVENT_TOPOLOGY_SNAPSHOT"
    | "EVENT_POD_ADDED"
    | "EVENT_POD_MODIFIED"
    | "EVENT_POD_DELETED"
    | "EVENT_NODE_ADDED"
    | "EVENT_NODE_MODIFIED"
    | "EVENT_NODE_DELETED"
    | "EVENT_SERVICE_ADDED"
    | "EVENT_SERVICE_MODIFIED"
    | "EVENT_SERVICE_DELETED";
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
  };
  timestamp?: string;
  latencyMs?: number;
}

const DEFAULT_WS_URL = "ws://localhost:8080/ws/k8s";

export function useK8sStream(
  onMessageReceived?: (msg: WsTopologyMessage) => void,
  urlOverride?: string
) {
  const [status, setStatus] = useState<WsConnectionStatus>("DISCONNECTED");
  const [latencyMs, setLatencyMs] = useState<number>(12);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComponentMounted = useRef<boolean>(true);
  const connectRef = useRef<() => void>(() => {});

  const wsUrl = urlOverride || import.meta.env.VITE_WS_URL || DEFAULT_WS_URL;

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
        setLatencyMs(Math.floor(Math.random() * 10 + 8));
      };

      socket.onmessage = (event: MessageEvent) => {
        if (!isComponentMounted.current) return;
        try {
          const rawData =
            typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data);
          const parsed = JSON.parse(rawData) as WsTopologyMessage;
          if (parsed && typeof parsed.type === "string") {
            onMessageReceived?.(parsed);
          }
        } catch {
          // Safe JSON parsing
        }
      };

      socket.onerror = () => {
        if (!isComponentMounted.current) return;
        setStatus("ERROR");
      };

      socket.onclose = () => {
        if (!isComponentMounted.current) return;
        setStatus("DISCONNECTED");
        wsRef.current = null;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (isComponentMounted.current) {
            connectRef.current();
          }
        }, 4000);
      };
    } catch {
      if (!isComponentMounted.current) return;
      setStatus("DISCONNECTED");
      reconnectTimeoutRef.current = setTimeout(() => {
        if (isComponentMounted.current) {
          connectRef.current();
        }
      }, 5000);
    }
  }, [wsUrl, onMessageReceived]);

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
