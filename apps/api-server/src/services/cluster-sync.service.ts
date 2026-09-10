import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { clusters } from "../db/schema.js";
import { decryptKubeconfig } from "../utils/crypto.js";

const getStreamerUrl = () => process.env.K8S_STREAMER_URL || "http://localhost:8080";

export interface ClusterSyncResult {
  clusterId: string;
  clusterName: string;
  success: boolean;
  status: "connected" | "disconnected";
  error?: string;
}

/**
 * Synchronizes a single cluster with the k8s-streamer gateway.
 * Decrypts Kubeconfig from database (or accepts raw override) and invokes /api/v1/clusters/register.
 * Updates cluster status in PostgreSQL based on the real-time response.
 */
export const syncClusterWithStreamer = async (
  cluster: {
    id: string;
    name: string;
    kubeconfig?: string | null;
    status?: string | null;
  },
  rawKubeconfigOverride?: string
): Promise<ClusterSyncResult> => {
  let rawKubeconfig = rawKubeconfigOverride;

  if (!rawKubeconfig) {
    if (!cluster.kubeconfig) {
      return {
        clusterId: cluster.id,
        clusterName: cluster.name,
        success: false,
        status: "disconnected",
        error: "No kubeconfig stored for this cluster",
      };
    }
    try {
      rawKubeconfig = decryptKubeconfig(cluster.kubeconfig);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ClusterSync] Decryption failed for cluster ${cluster.name} (${cluster.id}): ${errMsg}`);
      return {
        clusterId: cluster.id,
        clusterName: cluster.name,
        success: false,
        status: "disconnected",
        error: `Decryption error: ${errMsg}`,
      };
    }
  }

  const streamerUrl = getStreamerUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${streamerUrl}/api/v1/clusters/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId: cluster.id,
        kubeconfig: rawKubeconfig,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      await db
        .update(clusters)
        .set({
          status: "connected",
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(clusters.id, cluster.id));

      return {
        clusterId: cluster.id,
        clusterName: cluster.name,
        success: true,
        status: "connected",
      };
    }

    const errText = await res.text().catch(() => "Unknown gateway error");
    await db
      .update(clusters)
      .set({
        status: "disconnected",
        updatedAt: new Date(),
      })
      .where(eq(clusters.id, cluster.id));

    return {
      clusterId: cluster.id,
      clusterName: cluster.name,
      success: false,
      status: "disconnected",
      error: `Gateway returned ${res.status}: ${errText}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const errMsg = err instanceof Error ? err.message : String(err);

    // Update DB status to disconnected if not already
    if (cluster.status !== "disconnected") {
      await db
        .update(clusters)
        .set({
          status: "disconnected",
          updatedAt: new Date(),
        })
        .where(eq(clusters.id, cluster.id))
        .catch(() => {});
    }

    return {
      clusterId: cluster.id,
      clusterName: cluster.name,
      success: false,
      status: "disconnected",
      error: `Connection error: ${errMsg}`,
    };
  }
};

/**
 * Queries all persisted clusters in PostgreSQL and synchronizes each with k8s-streamer.
 * Safe to execute at startup or during scheduled background reconciliation.
 */
export const reconcileAllClusters = async (): Promise<ClusterSyncResult[]> => {
  const allClusters = await db
    .select({
      id: clusters.id,
      name: clusters.name,
      kubeconfig: clusters.kubeconfig,
      status: clusters.status,
    })
    .from(clusters);

  if (allClusters.length === 0) {
    return [];
  }

  // Pre-flight check: verify streamer gateway is alive
  const streamerUrl = getStreamerUrl();
  try {
    const healthRes = await fetch(`${streamerUrl}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthRes.ok) {
      console.warn(`[ClusterSync] Streaming gateway healthz responded with ${healthRes.status}. Skipping reconcile cycle.`);
      return [];
    }
  } catch {
    console.warn(`[ClusterSync] Streaming gateway unreachable at ${streamerUrl}. Skipping reconcile cycle.`);
    return [];
  }

  const results: ClusterSyncResult[] = [];
  for (const cluster of allClusters) {
    const res = await syncClusterWithStreamer(cluster);
    results.push(res);
  }

  return results;
};

/**
 * Hydrates all clusters on api-server startup.
 */
export const hydrateClustersOnStartup = async (): Promise<void> => {
  console.log("[ClusterSync] Hydrating clusters with streaming gateway on server startup...");
  try {
    const results = await reconcileAllClusters();
    const connected = results.filter((r) => r.success).length;
    console.log(`[ClusterSync] Startup hydration complete: ${connected}/${results.length} clusters active in streaming gateway.`);
  } catch (err) {
    console.error("[ClusterSync] Startup cluster hydration encountered an error:", err);
  }
};
