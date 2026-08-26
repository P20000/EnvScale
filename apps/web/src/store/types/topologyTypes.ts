import type { Edge } from "@xyflow/react";

export interface ApiToken {
  id: string;
  token: string;
  name: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  read: boolean;
  cluster?: string;
  targetPod?: string;
  type?: string;
}

export interface K8sIncidentEvent {
  eventId: string;
  reason: string;
  message: string;
  targetPod: string;
  namespace?: string;
  cluster?: string;
  severityType?: string;
  timestamp: string;
  resolvedAt?: string;
  status?: string;
}

export interface HistoryAction {
  type: "DELETE_RESOURCE" | "CREATE_RESOURCE" | "UPDATE_RESOURCE";
  resourceKind: string;
  namespace: string;
  resourceName: string;
  manifestSnapshot: Record<string, unknown>;
  associatedEdges?: Edge[];
  timestamp: number;
}

export interface DeleteModalState {
  isOpen: boolean;
  targetId: string;
  targetName: string;
  targetKind: string;
  namespace?: string;
}
