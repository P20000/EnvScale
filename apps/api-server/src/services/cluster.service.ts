import { and, eq } from "drizzle-orm";
import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";
import { db } from "../db/client.js";
import { clusters } from "../db/schema.js";
import { encryptKubeconfig } from "../utils/crypto.js";

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
    throw new ClusterConnectionError("Invalid kubeconfig");
  }

  const cluster = kubeConfig.getCurrentCluster();
  if (!cluster?.server) {
    throw new ClusterConnectionError("Kubeconfig has no current cluster server");
  }

  try {
    const api = kubeConfig.makeApiClient(CoreV1Api);
    await api.getAPIResources();
  } catch {
    throw new ClusterConnectionError("Unable to connect to the Kubernetes API server");
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
  return cluster;
};

export const listClusters = (workspaceId: string) =>
  db.select(publicClusterFields).from(clusters).where(eq(clusters.workspaceId, workspaceId));

export const deleteCluster = (workspaceId: string, clusterId: string) =>
  db.delete(clusters).where(and(eq(clusters.workspaceId, workspaceId), eq(clusters.id, clusterId)));