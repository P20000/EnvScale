import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { useTopologyStore } from "../store/useTopologyStore";

export type WsConnectionStatus = "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "ERROR";

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
  const shouldReconnectRef = useRef<boolean>(true);
  const reconnectAttemptRef = useRef<number>(0);

  const connectRef = useRef<() => void>(() => {});
  const onMessageReceivedRef = useRef(onMessageReceived);

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

  useEffect(() => {
    onMessageReceivedRef.current = onMessageReceived;
  }, [onMessageReceived]);

  const scheduleReconnect = useCallback(() => {
    if (!isComponentMounted.current || !shouldReconnectRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const attempt = reconnectAttemptRef.current;
    const baseDelay = 1000; // 1s base
    const maxDelay = 30000; // 30s max
    const expDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Add jitter (80% to 120% of delay)
    const jitter = 0.8 + Math.random() * 0.4;
    const delay = Math.round(expDelay * jitter);

    reconnectAttemptRef.current = attempt + 1;
    setStatus("RECONNECTING");

    reconnectTimeoutRef.current = setTimeout(() => {
      if (isComponentMounted.current && shouldReconnectRef.current) {
        connectRef.current();
      }
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current) return;

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setStatus(reconnectAttemptRef.current > 0 ? "RECONNECTING" : "CONNECTING");

    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = async () => {
        if (!isComponentMounted.current) return;
        setStatus("CONNECTED");
        reconnectAttemptRef.current = 0;

        const url = new URL(wsUrl);
        const clusterId = url.searchParams.get("clusterId");
        if (clusterId) {
          try {
            // Wait a brief moment to ensure informer has populated cache
            await new Promise((r) => setTimeout(r, 100));
            const streamerUrl = url.protocol === "wss:" ? `https://${url.host}` : `http://${url.host}`;
            const res = await fetch(`${streamerUrl}/api/v1/clusters/snapshot?clusterId=${clusterId}`);
            if (res.ok) {
              const snapshot = await res.json();
              if (onMessageReceivedRef.current) {
                onMessageReceivedRef.current?.({
                  type: "EVENT_SNAPSHOT_SYNC",
                  event: "EVENT_SNAPSHOT_SYNC",
                  data: snapshot,
                } as WsTopologyMessage);
                if (snapshot.nodes) {
                  snapshot.nodes.forEach((node: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_NODE_ADDED", event: "EVENT_NODE_ADDED", data: node } as WsTopologyMessage)
                  );
                }
                if (snapshot.pods) {
                  snapshot.pods.forEach((pod: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_POD_ADDED", event: "EVENT_POD_ADDED", data: pod } as WsTopologyMessage)
                  );
                }
                if (snapshot.services) {
                  snapshot.services.forEach((svc: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_SERVICE_ADDED", event: "EVENT_SERVICE_ADDED", data: svc } as WsTopologyMessage)
                  );
                }
                if (snapshot.deployments) {
                  snapshot.deployments.forEach((dep: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_DEPLOYMENT_ADDED", event: "EVENT_DEPLOYMENT_ADDED", data: dep } as WsTopologyMessage)
                  );
                }
                if (snapshot.replicaSets) {
                  snapshot.replicaSets.forEach((rs: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_REPLICA_SET_ADDED", event: "EVENT_REPLICA_SET_ADDED", data: rs } as WsTopologyMessage)
                  );
                }
                if (snapshot.statefulSets) {
                  snapshot.statefulSets.forEach((sts: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_STATEFUL_SET_ADDED", event: "EVENT_STATEFUL_SET_ADDED", data: sts } as WsTopologyMessage)
                  );
                }
                if (snapshot.ingresses) {
                  snapshot.ingresses.forEach((ing: unknown) =>
                    onMessageReceivedRef.current?.({ type: "EVENT_INGRESS_ADDED", event: "EVENT_INGRESS_ADDED", data: ing } as WsTopologyMessage)
                  );
                }
                
                // Notify store to run layout calculations once
                onMessageReceivedRef.current?.({
                  type: "EVENT_BATCH_COMPLETE",
                  event: "EVENT_BATCH_COMPLETE",
                  data: {}
                } as WsTopologyMessage);
              }
            }
          } catch (e) {
            console.warn("[EnvScale] Failed to fetch initial topology snapshot:", e);
          }
        }

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
        const startTime = performance.now();

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
            }

            const processingTime = Math.max(1, Math.round(performance.now() - startTime));
            const finalLatency = measuredLatency > 0 ? measuredLatency : processingTime;

            if (finalLatency > 0) {
              setLatencyMs(finalLatency);
            }

            const normalizedMsg: WsTopologyMessage = {
              type: eventType,
              event: eventType,
              payload: eventPayload as WsTopologyMessage["payload"],
              data: eventPayload,
              clusterId: typeof parsed.clusterId === "string" ? parsed.clusterId : undefined,
              timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
              latencyMs: finalLatency || undefined,
            };

            if (eventType) {
              onMessageReceivedRef.current?.(normalizedMsg);
            }
          }
        } catch {
          // Safe JSON parsing: malformed frame will not break socket
        }
      };

      socket.onerror = () => {
        if (!isComponentMounted.current) return;
        setStatus("ERROR");
        setLatencyMs(0);
      };

      socket.onclose = () => {
        if (!isComponentMounted.current) return;
        wsRef.current = null;
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        if (shouldReconnectRef.current) {
          scheduleReconnect();
        } else {
          setStatus("DISCONNECTED");
          setLatencyMs(0);
        }
      };
    } catch {
      if (!isComponentMounted.current) return;
      wsRef.current = null;
      if (shouldReconnectRef.current) {
        scheduleReconnect();
      } else {
        setStatus("DISCONNECTED");
        setLatencyMs(0);
      }
    }
  }, [wsUrl, scheduleReconnect]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("DISCONNECTED");
    setLatencyMs(0);
  }, []);

  const manualReconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    reconnectAttemptRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    isComponentMounted.current = true;
    shouldReconnectRef.current = true;
    connect();

    return () => {
      isComponentMounted.current = false;
      shouldReconnectRef.current = false;
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
    reconnect: manualReconnect,
    disconnect,
  };
}
