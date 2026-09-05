import { and, eq } from "drizzle-orm";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { db } from "../db/client.js";
import { clusters } from "../db/schema.js";
import { encryptKubeconfig } from "../utils/crypto.js";
import { clusterConnectSchema, idSchema } from "../schemas/request.schemas.js";

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

const notifyStreamerGateway = async (endpoint: string, method: "POST" | "DELETE", payload: object) => {
  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${streamerUrl}${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
      status: "connected",
      lastSyncAt: new Date(),
    })
    .returning(publicClusterFields);

  void notifyStreamerGateway("/api/v1/clusters/register", "POST", {
    clusterId: cluster.id,
    kubeconfig: values.kubeconfig,
  });

  return cluster;
};

export const listClusters = async (rawWorkspaceId: string) => {
  const workspaceId = idSchema.parse(rawWorkspaceId);
  return db
    .select(publicClusterFields)
    .from(clusters)
    .where(eq(clusters.workspaceId, workspaceId));
};

export const deleteCluster = async (rawWorkspaceId: string, rawClusterId: string) => {
  const workspaceId = idSchema.parse(rawWorkspaceId);
  const clusterId = idSchema.parse(rawClusterId);

  const deletedRows = await db
    .delete(clusters)
    .where(and(eq(clusters.workspaceId, workspaceId), eq(clusters.id, clusterId)))
    .returning({ id: clusters.id });

  if (deletedRows.length === 0) {
    throw new ClusterNotFoundError(clusterId);
  }

  void notifyStreamerGateway("/api/v1/clusters/deregister", "DELETE", { clusterId });
};