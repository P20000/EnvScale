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
  PVC_MUTATED: 'EVENT_PVC_MUTATED',
  PVC_DELETED: 'EVENT_PVC_DELETED',
  PV_MUTATED: 'EVENT_PV_MUTATED',
  PV_DELETED: 'EVENT_PV_DELETED',
  CONFIGMAP_MUTATED: 'EVENT_CONFIGMAP_MUTATED',
  CONFIGMAP_DELETED: 'EVENT_CONFIGMAP_DELETED',
  SECRET_MUTATED: 'EVENT_SECRET_MUTATED',
  SECRET_DELETED: 'EVENT_SECRET_DELETED',
  CHAOS_FAULT_INJECTED: 'EVENT_CHAOS_FAULT_INJECTED',
  CHAOS_FAULT_CLEARED: 'EVENT_CHAOS_FAULT_CLEARED',
  PDB_MUTATED: 'EVENT_PDB_MUTATED',
  PDB_DELETED: 'EVENT_PDB_DELETED',
  RESOURCE_QUOTA_MUTATED: 'EVENT_RESOURCE_QUOTA_MUTATED',
  RESOURCE_QUOTA_DELETED: 'EVENT_RESOURCE_QUOTA_DELETED',
  LIMIT_RANGE_MUTATED: 'EVENT_LIMIT_RANGE_MUTATED',
  LIMIT_RANGE_DELETED: 'EVENT_LIMIT_RANGE_DELETED',
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
  volumes?: PodVolumeMountInfo[];
  configMaps?: PodConfigReference[];
  secrets?: PodSecretReference[];
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

// Pod Volume Mount Information
export interface PodVolumeMountInfo {
  name: string;
  pvcName?: string;
  mountPath?: string;
  readOnly?: boolean;
}

// PVC State Payload for Topology Engine
export type PVCStatusPhase = 'Bound' | 'Pending' | 'Lost';

export interface PVCTopologyData {
  name: string;
  namespace: string;
  phase: PVCStatusPhase;
  volumeName: string;
  storageClassName: string;
  requestedSize: string;
  capacity: string;
  accessModes: string[];
  volumeMode: string;
  labels?: Record<string, string>;
  mountedByPods?: string[];
  createdAt: string;
}

// Physical PersistentVolume Data Payload
export interface PVTopologyData {
  name: string;
  phase: 'Available' | 'Bound' | 'Released' | 'Failed';
  capacity: string;
  accessModes: string[];
  reclaimPolicy: string;
  storageClassName: string;
  claimRefName?: string;
  claimRefNs?: string;
  volumeSourceType: string;
  labels?: Record<string, string>;
  createdAt: string;
}

// Pod Configuration Reference
export interface PodConfigReference {
  name: string;
  type: 'volume' | 'env' | 'envFrom';
  mountPath?: string;
  key?: string;
  optional?: boolean;
}

// Pod Secret Reference
export interface PodSecretReference {
  name: string;
  type: 'volume' | 'env' | 'envFrom';
  mountPath?: string;
  key?: string;
  optional?: boolean;
}

// ConfigMap State Payload for Topology Engine
export interface ConfigMapTopologyData {
  name: string;
  namespace: string;
  keys: string[];
  binaryKeys?: string[];
  dataCount: number;
  immutable: boolean;
  labels?: Record<string, string>;
  mountedByWorkloads?: string[];
  createdAt: string;
  age: string;
}

// Secret State Payload for Topology Engine (strictly sanitized metadata)
export interface SecretTopologyData {
  name: string;
  namespace: string;
  type: string; // e.g. "Opaque", "kubernetes.io/tls"
  keys: string[]; // Key names ONLY — zero raw data payload
  dataCount: number;
  immutable: boolean;
  labels?: Record<string, string>;
  mountedByWorkloads?: string[];
  createdAt: string;
  age: string;
}

// Chaos Fault Injected/Cleared Payload
export interface ChaosFaultEvent {
  faultId: string;
  faultType: 'crash' | 'oom-pressure' | 'scale-down' | string;
  target: string;
  name: string;
  namespace: string;
  clusterId: string;
  status: 'injected' | 'cleared' | 'failed' | string;
  message?: string;
  timestamp: string;
  pdbBreached?: boolean;
  pdbName?: string;
}

// PodDisruptionBudget State Payload for Topology Engine
export interface PDBTopologyData {
  name: string;
  namespace: string;
  minAvailable?: string | number;
  maxUnavailable?: string | number;
  currentHealthy: number;
  desiredHealthy: number;
  expectedPods: number;
  disruptionsAllowed: number;
  matchLabels: Record<string, string>;
  createdAt?: string;
}

// ResourceQuota State Payload for Topology Engine
export interface ResourceQuotaTopologyData {
  name: string;
  namespace: string;
  hard: Record<string, string>;
  used: Record<string, string>;
  cpuLimitCores?: number;
  cpuUsedCores?: number;
  cpuUtilizationPct?: number;
  memoryLimitBytes?: number;
  memoryUsedBytes?: number;
  memoryUtilizationPct?: number;
  podsLimit?: number;
  podsUsed?: number;
  podsUtilizationPct?: number;
  isBreached?: boolean;
  isWarning?: boolean;
  createdAt?: string;
}

// LimitRange Container/Pod Constraint Item
export interface LimitRangeItemData {
  type: string; // "Container" | "Pod" | "PersistentVolumeClaim"
  min?: Record<string, string>;
  max?: Record<string, string>;
  default?: Record<string, string>;
  defaultRequest?: Record<string, string>;
  maxLimitRequestRatio?: Record<string, string>;
}

// LimitRange State Payload for Topology Engine
export interface LimitRangeTopologyData {
  name: string;
  namespace: string;
  limits: LimitRangeItemData[];
  createdAt?: string;
}


