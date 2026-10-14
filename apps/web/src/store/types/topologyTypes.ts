import type { Edge } from "@xyflow/react";

export interface ApiToken {
  id: string;
  token: string;
  name: string;
  createdAt: string;
}

export interface Cluster {
  id: string;
  name: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  read: boolean;
  namespace?: string;
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

export interface K8sDaemonSetData extends Record<string, unknown> {
  name: string;
  namespace: string;
  desiredNumberScheduled: number;
  currentNumberScheduled: number;
  numberReady: number;
  numberUnavailable?: number;
  images?: string[];
  labels?: Record<string, string>;
  createdAt?: string;
}

export interface K8sCronJobData extends Record<string, unknown> {
  name: string;
  namespace: string;
  schedule?: string;
  suspend?: boolean;
  activeJobsCount?: number;
  lastScheduleTime?: string;
  lastSuccessfulTime?: string;
  images?: string[];
  labels?: Record<string, string>;
  createdAt?: string;
}

export interface K8sJobData extends Record<string, unknown> {
  name: string;
  namespace: string;
  completions: number;
  parallelism: number;
  succeeded: number;
  failed: number;
  active: number;
  startTime?: string;
  completionTime?: string;
  durationSeconds: number;
  labels?: Record<string, string>;
  ownerKind?: string;
  ownerName?: string;
  createdAt?: string;
}

export interface PodVolumeInfo {
  name: string;
  pvcName?: string;
  mountPath?: string;
  readOnly?: boolean;
}

export interface K8sPVCData extends Record<string, unknown> {
  name: string;
  namespace: string;
  phase: "Bound" | "Pending" | "Lost";
  volumeName?: string;
  storageClassName?: string;
  requestedSize?: string;
  capacity?: string;
  accessModes?: string[];
  volumeMode?: string;
  labels?: Record<string, string>;
  mountedByPods?: string[];
  createdAt?: string;
}

export interface K8sPVData extends Record<string, unknown> {
  name: string;
  phase: "Available" | "Bound" | "Released" | "Failed";
  capacity?: string;
  accessModes?: string[];
  reclaimPolicy?: string;
  storageClassName?: string;
  claimRefName?: string;
  claimRefNs?: string;
  volumeSourceType?: string;
  labels?: Record<string, string>;
  createdAt?: string;
}

export interface PodConfigReference {
  name: string;
  type: "volume" | "env" | "envFrom";
  mountPath?: string;
  key?: string;
  optional?: boolean;
}

export interface PodSecretReference {
  name: string;
  type: "volume" | "env" | "envFrom";
  mountPath?: string;
  key?: string;
  optional?: boolean;
}

export interface K8sConfigMapData extends Record<string, unknown> {
  name: string;
  namespace: string;
  keys: string[];
  binaryKeys?: string[];
  dataCount: number;
  immutable: boolean;
  labels?: Record<string, string>;
  mountedByWorkloads?: string[];
  createdAt?: string;
  age?: string;
}

export interface K8sSecretData extends Record<string, unknown> {
  name: string;
  namespace: string;
  type: string;
  keys: string[]; // Key names only
  dataCount: number;
  immutable: boolean;
  labels?: Record<string, string>;
  mountedByWorkloads?: string[];
  createdAt?: string;
  age?: string;
}

export interface ChaosFaultEvent {
  faultId: string;
  faultType: "crash" | "oom-pressure" | "scale-down" | string;
  target: string;
  name: string;
  namespace: string;
  clusterId: string;
  status: "injected" | "cleared" | "failed" | string;
  message?: string;
  timestamp: string;
}

export interface ProbeSpecInfo {
  type: "http" | "tcp" | "exec" | string;
  path?: string;
  port?: number;
  initialDelaySeconds: number;
  periodSeconds: number;
  timeoutSeconds: number;
  failureThreshold: number;
}

export interface K8sHPAData extends Record<string, unknown> {
  name: string;
  namespace: string;
  targetRefKind: string;
  targetRefName: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  desiredReplicas: number;
  currentCpuUtil?: number;
  targetCpuUtil?: number;
  lastScaleTime?: string;
}

export interface K8sNetworkPolicyData extends Record<string, unknown> {
  name: string;
  namespace: string;
  podSelector: Record<string, string>;
  policyTypes: string[];
  ingressRules: string[];
  targetPods?: string[];
}

