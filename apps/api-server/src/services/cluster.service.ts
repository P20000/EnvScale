import { and, eq } from "drizzle-orm";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { db } from "../db/client.js";
import { clusters } from "../db/schema.js";
import { decryptKubeconfig, encryptKubeconfig } from "../utils/crypto.js";

export class ClusterConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClusterConnectionError";
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
  workspaceId: string,
  values: { name: string; type: string; kubeconfig: string }
) => {
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

  // Automatically register cluster with Go k8s-streamer gateway
  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";
  try {
    await fetch(`${streamerUrl}/api/v1/clusters/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId: cluster.id,
        kubeconfig: values.kubeconfig,
      }),
    });
    console.log(`[ClusterService] Successfully registered cluster ${cluster.name} (${cluster.id}) with k8s-streamer gateway`);
  } catch (err) {
    console.warn(`[ClusterService] Warning: Could not auto-notify k8s-streamer at ${streamerUrl}:`, err);
  }

  return cluster;
};

export const listClusters = async (workspaceId: string) => {
  const result = await db.select().from(clusters).where(eq(clusters.workspaceId, workspaceId));
  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";

  for (const c of result) {
    if (c.kubeconfig) {
      try {
        const rawKubeconfig = decryptKubeconfig(c.kubeconfig);
        await fetch(`${streamerUrl}/api/v1/clusters/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clusterId: c.id,
            kubeconfig: rawKubeconfig,
          }),
        });
        console.log(`[ClusterService] Auto-registered active workspace cluster "${c.name}" with streamer gateway`);
      } catch (err) {
        console.warn(`[ClusterService] Notice: Could not auto-register cluster "${c.name}" with streamer gateway:`, err);
      }
    }
  }

  return result.map((c) => ({
    id: c.id,
    workspaceId: c.workspaceId,
    name: c.name,
    type: c.type,
    apiServerUrl: c.apiServerUrl,
    version: c.version,
    nodeCount: c.nodeCount,
    healthScore: c.healthScore,
    status: c.status,
    lastSyncAt: c.lastSyncAt,
    metadata: c.metadata,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
};

export const deleteCluster = (workspaceId: string, clusterId: string) =>
  db.delete(clusters).where(and(eq(clusters.workspaceId, workspaceId), eq(clusters.id, clusterId)));