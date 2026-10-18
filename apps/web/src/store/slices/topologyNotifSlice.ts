import type { TopologyState } from "../useTopologyStore";
import type { ApiToken, NotificationItem } from "../types/topologyTypes";
import { toast } from "../../lib/toast";
import { useUIStore } from "../useUIStore";

export function handleAddToken(
  set: (partial: Partial<TopologyState> | ((state: TopologyState) => Partial<TopologyState>)) => void,
  name = "Default Token",
  tokenStr?: string
): ApiToken {
  const newToken: ApiToken = {
    id: `token-${Date.now()}`,
    token:
      tokenStr ||
      `env_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`,
    name: (name || "Default Token").trim() || "Default Token",
    createdAt: new Date().toISOString(),
  };
  set((state) => ({ tokens: [newToken, ...state.tokens] }));
  return newToken;
}

export function handleAddNotification(
  get: () => TopologyState,
  set: (partial: Partial<TopologyState> | ((state: TopologyState) => Partial<TopologyState>)) => void,
  title: string,
  message: string,
  severity: "CRITICAL" | "WARNING" | "INFO" = "INFO"
) {
  const newNotif: NotificationItem = {
    id: `notif-${Date.now()}`,
    title,
    message,
    time: "Just now",
    severity,
    read: false,
    cluster: get().activeCluster,
  };
  set((state) => ({ notifications: [newNotif, ...state.notifications].slice(0, 50) }));

  if (severity === "CRITICAL") {
    toast.error(title, message);
  } else if (severity === "WARNING") {
    toast.warning(title, message);
  } else {
    toast.info(title, message);
  }

  // Outbound Webhook dispatch (Slack / Discord / HTTP)
  try {
    const webhookUrl = useUIStore.getState().alertWebhookUrl;
    const criticalOnly = useUIStore.getState().alertWebhookCriticalOnly;
    if (webhookUrl && (!criticalOnly || severity === "CRITICAL")) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🚨 [EnvScale Alert] ${title}: ${message}`,
          title,
          message,
          severity,
          cluster: get().activeCluster,
          timestamp: new Date().toISOString(),
        }),
        mode: "no-cors",
      }).catch((err) => console.warn("[EnvScale] Outbound webhook dispatch failed:", err));
    }
  } catch {
    // Non-blocking
  }
}

