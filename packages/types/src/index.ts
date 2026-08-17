// Workspace RBAC Roles
export type WorkspaceRole = 'ADMIN' | 'MEMBER' | 'VIEWER';

// User Schema Type Definition
export interface User {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// Workspace Definition
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// Cluster Connection State
export type ClusterStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL' | 'DISCONNECTED';

export interface Cluster {
  id: string;
  workspaceId: string;
  name: string;
  apiServerUrl: string;
  status: ClusterStatus;
  healthScore: number;
  lastPingAt: string;
}

// Streaming Event Constants
export const WS_EVENTS = {
  POD_STATUS_CHANGED: 'EVENT_POD_STATUS_CHANGED',
  NODE_MUTATED: 'EVENT_NODE_MUTATED',
  SERVICE_MUTATED: 'EVENT_SERVICE_MUTATED',
  LOG_LINE: 'EVENT_LOG_LINE',
  ALERT_TRIGGERED: 'EVENT_ALERT_TRIGGERED',
  HEARTBEAT: 'EVENT_HEARTBEAT',
} as const;

export type WSEventType = typeof WS_EVENTS[keyof typeof WS_EVENTS];

// WebSocket Event Envelope Payload
export interface WSEventPayload<T = unknown> {
  event: WSEventType;
  clusterId: string;
  timestamp: string;
  data: T;
}

// Pod State Payload for Topology Engine
export type PodStatusPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown' | 'CrashLoopBackOff' | 'OOMKilled';

export interface PodTopologyData {
  name: string;
  namespace: string;
  nodeName: string;
  phase: PodStatusPhase;
  restartCount: number;
  cpuUsagePct?: number;
  memoryUsageMb?: number;
  labels: Record<string, string>;
  createdAt: string;
}

// Node State Payload for Topology Engine
export interface NodeTopologyData {
  name: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  cpuCapacity: string;
  memoryCapacity: string;
  podCapacity: number;
  labels: Record<string, string>;
}

// Service State Payload for Topology Engine
export interface ServiceTopologyData {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer' | 'ExternalName';
  clusterIP: string;
  selector: Record<string, string>;
  targetPorts: number[];
}

// Log Line Payload for Live Log Streamer
export interface LogStreamPayload {
  podName: string;
  namespace: string;
  container: string;
  log: string;
  stream: 'stdout' | 'stderr';
  timestamp: string;
}
