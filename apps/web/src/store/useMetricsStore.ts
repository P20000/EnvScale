import { create } from "zustand";
import { STREAMER_BASE_URL, getAuthHeaders } from "../config/api";

export interface TelemetryPoint {
  timestamp: number;
  value: number;
}

export interface MetricDataPoint {
  timestamp: number;
  cpuPct: number;
  memoryPct: number;
}

const createInitialHistory = (fillValue = 0): TelemetryPoint[] => {
  const now = Date.now();
  const points: TelemetryPoint[] = [];
  for (let i = 59; i >= 0; i--) {
    points.push({
      timestamp: now - i * 1000,
      value: fillValue,
    });
  }
  return points;
};

const padHistory = (points: TelemetryPoint[], fallbackVal = 0): TelemetryPoint[] => {
  if (points.length >= 60) return points.slice(points.length - 60);
  const earliestTs = points[0]?.timestamp || Date.now();
  const missingCount = 60 - points.length;
  const padding: TelemetryPoint[] = [];
  const firstVal = points[0]?.value ?? fallbackVal;
  for (let i = missingCount; i > 0; i--) {
    padding.push({
      timestamp: earliestTs - i * 1000,
      value: firstVal,
    });
  }
  return [...padding, ...points];
};

export interface MetricsState {
  cpuHistory: TelemetryPoint[];
  memoryHistory: TelemetryPoint[];
  setMetricsHistory: (history: MetricDataPoint[]) => void;
  appendMetricPoint: (point: MetricDataPoint) => void;
  fetchMetricsHistory: (clusterId: string) => Promise<void>;
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  cpuHistory: createInitialHistory(),
  memoryHistory: createInitialHistory(),

  setMetricsHistory: (history) => {
    if (!history || history.length === 0) return;
    const cpuPoints = history.map((h) => ({ timestamp: h.timestamp, value: h.cpuPct }));
    const memPoints = history.map((h) => ({ timestamp: h.timestamp, value: h.memoryPct }));
    set({
      cpuHistory: padHistory(cpuPoints, history[0]?.cpuPct || 0),
      memoryHistory: padHistory(memPoints, history[0]?.memoryPct || 0),
    });
  },

  appendMetricPoint: (point) => {
    set((state) => {
      const nextCpu = [...state.cpuHistory.slice(1), { timestamp: point.timestamp, value: point.cpuPct }];
      const nextMem = [...state.memoryHistory.slice(1), { timestamp: point.timestamp, value: point.memoryPct }];
      return { cpuHistory: nextCpu, memoryHistory: nextMem };
    });
  },

  fetchMetricsHistory: async (clusterId) => {
    if (!clusterId) return;
    try {
      const res = await fetch(
        `${STREAMER_BASE_URL}/api/v1/clusters/metrics/history?clusterId=${encodeURIComponent(clusterId)}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.history) && data.history.length > 0) {
        get().setMetricsHistory(data.history);
      }
    } catch {
      // Ignored: real-time streaming fallback handles ongoing updates
    }
  },
}));
