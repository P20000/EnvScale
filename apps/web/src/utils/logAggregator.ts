import type { PodLogLine } from "../types/logs";

export interface AggregatedLogLine extends PodLogLine {
  count: number;
  firstTimestamp: string;
  lastTimestamp: string;
}

export function isNoiseLog(log: PodLogLine): boolean {
  const msg = (log.message || "").toLowerCase();
  const raw = (log.parsed?.rawText || "").toLowerCase();
  const evt = (log.parsed?.attributes?.event || "").toString().toLowerCase();

  if (evt === "heartbeat" || msg.includes("heartbeat")) return true;
  if (
    msg.includes("/healthz") ||
    msg.includes("/livez") ||
    msg.includes("/readyz") ||
    msg.includes("/metrics")
  )
    return true;
  if (raw.includes("heartbeat") || raw.includes("/healthz") || raw.includes("/metrics"))
    return true;

  return false;
}

export function aggregateConsecutiveLogs(
  logs: PodLogLine[],
  hideNoise: boolean = false
): AggregatedLogLine[] {
  if (!logs || logs.length === 0) return [];

  const filtered = hideNoise ? logs.filter((l) => !isNoiseLog(l)) : logs;
  if (filtered.length === 0) return [];

  const result: AggregatedLogLine[] = [];

  for (const item of filtered) {
    const prev = result[result.length - 1];

    const currentMsg = item.parsed?.message || item.message;
    const prevMsg = prev?.parsed?.message || prev?.message;

    const currentSource = item.source || item.podName || "";
    const prevSource = prev?.source || prev?.podName || "";

    const currentLevel = item.parsed?.level || item.level;
    const prevLevel = prev?.parsed?.level || prev?.level;

    if (
      prev &&
      currentMsg === prevMsg &&
      currentSource === prevSource &&
      currentLevel === prevLevel
    ) {
      prev.count += 1;
      prev.lastTimestamp = item.timestamp || new Date().toISOString();
    } else {
      result.push({
        ...item,
        count: 1,
        firstTimestamp: item.timestamp || new Date().toISOString(),
        lastTimestamp: item.timestamp || new Date().toISOString(),
      });
    }
  }

  return result;
}
