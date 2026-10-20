import { snapshotClusterHealth } from "../services/health-calculator.service.js";

const defaultIntervalMs = 60 * 60 * 1000;

const getIntervalMs = () => {
  const configuredInterval = Number(process.env.HEALTH_SNAPSHOT_INTERVAL_MS);
  return Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : defaultIntervalMs;
};

export const runHealthSnapshot = async () => {
  try {
    const snapshots = await snapshotClusterHealth();
    console.log(`Health snapshots written: ${snapshots.length}`);
  } catch (error) {
    console.error("Health snapshot worker failed", error);
  }
};

export const startHealthSnapshotWorker = () => {
  void runHealthSnapshot();
  const timer = setInterval(() => void runHealthSnapshot(), getIntervalMs());
  timer.unref();
  return timer;
};