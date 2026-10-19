import { and, eq, or } from "drizzle-orm";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { db } from "../db/client.js";
import { clusters } from "../db/schema.js";
import { encryptKubeconfig } from "../utils/crypto.js";
import { clusterConnectSchema, idSchema } from "../schemas/request.schemas.js";
import { syncClusterWithStreamer } from "./cluster-sync.service.js";
import { createServiceToken } from "./auth.service.js";

export class ClusterConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClusterConnectionError";
  }
}

export class ClusterNotFoundError extends Error {
  constructor(clusterId: string) {
    super(`Cluster with ID ${clusterId} was not found in this workspace`);
    this.name = "ClusterNotFoundError";
  }
}

const publicClusterFields = {
  id: clusters.id,
  workspaceId: clusters.workspaceId,
  name: clusters.name,
  type: clusters.type,
  apiServerUrl: clusters.apiServerUrl,
  version: clusters.version,
  nodeCount: clusters.nodeCount,
  healthScore: clusters.healthScore,
  status: clusters.status,
  lastSyncAt: clusters.lastSyncAt,
  metadata: clusters.metadata,
  createdAt: clusters.createdAt,
  updatedAt: clusters.updatedAt,
};

const notifyStreamerGateway = async (endpoint: string, method: "POST" | "DELETE", payload?: object) => {
  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const serviceToken = createServiceToken();
    const res = await fetch(`${streamerUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorText = await res.text().catch(() => "Unknown error");
      console.warn(`[ClusterService] Gateway notify failed (${res.status}): ${errorText}`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[ClusterService] Gateway network error (${method} ${endpoint}):`, err instanceof Error ? err.message : err);
  }
};

const validateKubeconfig = async (kubeconfig: string) => {
  const kubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromString(kubeconfig);
  } catch {
    throw new ClusterConnectionError("Invalid kubeconfig: YAML syntax parsing failed");
  }

  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster?.server) {
    throw new ClusterConnectionError("Kubeconfig error: missing active context cluster server URL");
  }

  try {
    const api = kubeConfig.makeApiClient(CoreV1Api);
    await api.getAPIResources();
  } catch (err) {
    console.warn(`[ClusterService] Notice: API server reachability handshake check skipped for ${cluster.server}:`, err instanceof Error ? err.message : err);
  }

  return { apiServerUrl: cluster.server };
};

export const connectCluster = async (
  rawWorkspaceId: string,
  rawValues: { name: string; type: string; kubeconfig: string }
) => {
  const workspaceId = idSchema.parse(rawWorkspaceId);
  const values = clusterConnectSchema.parse(rawValues);

  const connection = await validateKubeconfig(values.kubeconfig);
  const encryptedKubeconfig = encryptKubeconfig(values.kubeconfig);

  const [cluster] = await db
    .insert(clusters)
    .values({
      workspaceId,
      name: values.name,
      type: values.type,
      kubeconfig: encryptedKubeconfig,
      apiServerUrl: connection.apiServerUrl,
      status: "disconnected",
      lastSyncAt: new Date(),
    })
    .returning(publicClusterFields);

  // Synchronously attempt initial registration with streamer gateway
  const syncResult = await syncClusterWithStreamer(cluster, values.kubeconfig);
  if (syncResult.success) {
    cluster.status = "connected";
  } else {
    console.log(`[ClusterService] Cluster ${cluster.name} registered offline. Background reconciler will auto-connect once reachable.`);
  }

  return cluster;
};

export const listClusters = async (rawWorkspaceId: string) => {
  const workspaceId = idSchema.parse(rawWorkspaceId);
  return db
    .select(publicClusterFields)
    .from(clusters)
    .where(eq(clusters.workspaceId, workspaceId));
};

const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

export const deleteCluster = async (rawWorkspaceId: string, rawClusterId: string) => {
  const workspaceId = idSchema.parse(rawWorkspaceId);
  const condition = isUuid(rawClusterId)
    ? and(eq(clusters.workspaceId, workspaceId), or(eq(clusters.id, rawClusterId), eq(clusters.name, rawClusterId)))
    : and(eq(clusters.workspaceId, workspaceId), eq(clusters.name, rawClusterId));

  const deletedRows = await db
    .delete(clusters)
    .where(condition!)
    .returning({ id: clusters.id });

  if (deletedRows.length === 0) {
    throw new ClusterNotFoundError(rawClusterId);
  }

  const deletedId = deletedRows[0].id;
  void notifyStreamerGateway(`/api/v1/clusters?clusterId=${encodeURIComponent(deletedId)}`, "DELETE");
};

export const getClusterLayout = async (rawClusterId: string, userId?: string) => {
  const condition = isUuid(rawClusterId)
    ? or(eq(clusters.id, rawClusterId), eq(clusters.name, rawClusterId))
    : eq(clusters.name, rawClusterId);

  const rows = await db
    .select({ id: clusters.id, metadata: clusters.metadata })
    .from(clusters)
    .where(condition!)
    .limit(1);

  if (rows.length === 0) {
    return { positions: {} };
  }

  const meta = (rows[0].metadata as Record<string, unknown>) || {};
  const userLayouts = (meta.userLayouts as Record<string, unknown>) || {};
  const effectiveKey = userId || "default";
  const positions = (userLayouts[effectiveKey] || meta.layout || {}) as Record<string, { x: number; y: number }>;

  return { positions };
};

export const saveClusterLayout = async (
  rawClusterId: string,
  layout: Record<string, { x: number; y: number }>,
  userId?: string
) => {
  const condition = isUuid(rawClusterId)
    ? or(eq(clusters.id, rawClusterId), eq(clusters.name, rawClusterId))
    : eq(clusters.name, rawClusterId);

  const rows = await db
    .select({ id: clusters.id, metadata: clusters.metadata })
    .from(clusters)
    .where(condition!)
    .limit(1);

  if (rows.length === 0) {
    throw new ClusterNotFoundError(rawClusterId);
  }

  const targetId = rows[0].id;
  const currentMeta = (rows[0].metadata as Record<string, unknown>) || {};
  const userLayouts = ((currentMeta.userLayouts as Record<string, unknown>) || {}) as Record<string, unknown>;
  const effectiveKey = userId || "default";

  const updatedMetadata = {
    ...currentMeta,
    userLayouts: {
      ...userLayouts,
      [effectiveKey]: layout,
    },
    layout,
  };

  await db
    .update(clusters)
    .set({ metadata: updatedMetadata, updatedAt: new Date() })
    .where(eq(clusters.id, targetId));

  return { positions: layout };
};

export const resetClusterLayout = async (rawClusterId: string, userId?: string) => {
  const condition = isUuid(rawClusterId)
    ? or(eq(clusters.id, rawClusterId), eq(clusters.name, rawClusterId))
    : eq(clusters.name, rawClusterId);

  const rows = await db
    .select({ id: clusters.id, metadata: clusters.metadata })
    .from(clusters)
    .where(condition!)
    .limit(1);

  if (rows.length === 0) {
    return { positions: {} };
  }

  const targetId = rows[0].id;
  const currentMeta = (rows[0].metadata as Record<string, unknown>) || {};
  const userLayouts = { ...(((currentMeta.userLayouts as Record<string, unknown>) || {}) as Record<string, unknown>) };
  if (userId && userLayouts[userId]) {
    delete userLayouts[userId];
  }
  delete currentMeta.layout;

  await db
    .update(clusters)
    .set({
      metadata: { ...currentMeta, userLayouts },
      updatedAt: new Date(),
    })
    .where(eq(clusters.id, targetId));

  return { positions: {} };
};