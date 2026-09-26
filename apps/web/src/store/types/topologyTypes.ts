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

export interface K8sPVData extends Record<string, unknown> {
  name: string;
  status: "Available" | "Bound" | "Released" | "Failed" | string;
  capacity?: string;
  accessModes?: string[];
  reclaimPolicy?: string;
  storageClassName?: string;
  volumeMode?: string;
  claimRef?: { name: string; namespace: string };
  volumeSource?: string;  // e.g. "CSI", "Local", "NFS", "AWSElasticBlockStore"
  csiDriver?: string;     // e.g. "ebs.csi.aws.com"
  csiVolumeHandle?: string;
  nfsServer?: string;
  nfsPath?: string;
  localPath?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  createdAt?: string;
  rawResource?: Record<string, unknown>;
}

export interface K8sStorageClassData extends Record<string, unknown> {
  name: string;
  provisioner: string;
  reclaimPolicy?: string;
  volumeBindingMode?: string;
  allowVolumeExpansion?: boolean;
  parameters?: Record<string, string>;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  createdAt?: string;
  rawResource?: Record<string, unknown>;
}

export interface K8sVolumeSnapshotData extends Record<string, unknown> {
  name: string;
  namespace: string;
  readyToUse?: boolean;
  sourcePVCName?: string;
  volumeSnapshotClassName?: string;
  snapshotContentName?: string;
  restoreSize?: string;
  createdAt?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  rawResource?: Record<string, unknown>;
}

export interface K8sVolumeSnapshotContentData extends Record<string, unknown> {
  name: string;
  driver?: string;
  snapshotHandle?: string;
  deletionPolicy?: string;
  volumeSnapshotRef?: { name: string; namespace: string };
  sourceVolumeHandle?: string;
  restoreSize?: number;
  createdAt?: string;
  labels?: Record<string, string>;
  rawResource?: Record<string, unknown>;
}
