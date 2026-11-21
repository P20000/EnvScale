import { reconcileAllClusters } from "../services/cluster-sync.service.js";

const DEFAULT_INTERVAL_MS = 20_000; // 20 seconds

const getIntervalMs = (): number => {
  const configured = Number(process.env.CLUSTER_RECONCILE_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 1000 ? configured : DEFAULT_INTERVAL_MS;
};

let activeTimeout: NodeJS.Timeout | null = null;
let isReconciling = false;
let isRunning = false;

/**
 * Executes a single reconciliation cycle with mutex protection against overlapping runs.
 */
export const runClusterReconciliationCycle = async (): Promise<void> => {
  if (isReconciling) {
    console.warn("[ClusterReconcile] Previous cycle still in progress. Skipping overlapping run to prevent thundering herd.");
    return;
  }

  isReconciling = true;
  try {
    const results = await reconcileAllClusters();
    if (results.length > 0) {
      const connected = results.filter((r) => r.success).length;
      console.log(`[ClusterReconcile] Cycle completed: ${connected}/${results.length} clusters connected.`);
    }
  } catch (error) {
    console.error("[ClusterReconcile] Reconciliation cycle error:", error);
  } finally {
    isReconciling = false;
  }
};

/**
 * Schedules the next cycle recursively after the previous one completes.
 * This guarantees no concurrent execution even if a cluster ping times out.
 */
const scheduleNextCycle = (): void => {
  if (!isRunning) return;

  const interval = getIntervalMs();
  activeTimeout = setTimeout(async () => {
    if (!isRunning) return;
    await runClusterReconciliationCycle();
    scheduleNextCycle();
  }, interval);

  activeTimeout.unref();
};

/**
 * Starts the background cluster reconciliation worker using recursive setTimeout scheduling.
 */
export const startClusterReconcileWorker = (): void => {
  if (isRunning) {
    console.warn("[ClusterReconcile] Worker is already running.");
    return;
  }

  isRunning = true;
  console.log(`[ClusterReconcile] Starting cluster reconciliation worker (interval: ${getIntervalMs()}ms)...`);
  
  // Run first cycle shortly after boot, then schedule subsequent runs recursively
  activeTimeout = setTimeout(async () => {
    if (!isRunning) return;
    await runClusterReconciliationCycle();
    scheduleNextCycle();
  }, 2000);
  activeTimeout.unref();
};

/**
 * Gracefully terminates the reconciliation worker and clears active timers.
 */
export const stopClusterReconcileWorker = (): void => {
  isRunning = false;
  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
  console.log("[ClusterReconcile] Background cluster reconciliation worker stopped cleanly.");
};
