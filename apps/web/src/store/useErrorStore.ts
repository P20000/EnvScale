import { create } from "zustand";
import type { AppError, HealthCheckStatus } from "../types/errors";

interface ErrorStoreState {
  activeError: AppError | null;
  rateLimitSeconds: number | null;
  healthStatus: HealthCheckStatus;
  
  setError: (error: Omit<AppError, "id" | "timestamp"> & { id?: string; timestamp?: number }) => void;
  clearError: () => void;
  dismissError: (id?: string) => void;
  startRateLimitCountdown: (seconds: number) => void;
  startHealthDaemon: (healthUrl?: string, onRecover?: () => void) => void;
  stopHealthDaemon: () => void;
}

let healthDaemonTimer: ReturnType<typeof setInterval> | null = null;
let rateLimitTimer: ReturnType<typeof setInterval> | null = null;

export const useErrorStore = create<ErrorStoreState>((set, get) => ({
  activeError: null,
  rateLimitSeconds: null,
  healthStatus: {
    isChecking: false,
    attempts: 0,
    lastCheckedAt: null,
    serverReachable: true,
  },

  setError: (err) => {
    const error: AppError = {
      ...err,
      id: err.id || `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: err.timestamp || Date.now(),
    };
    set({ activeError: error });

    // If 502/503/504, automatically activate the health check daemon
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      get().startHealthDaemon();
    }
  },

  clearError: () => {
    get().stopHealthDaemon();
    if (rateLimitTimer) {
      clearInterval(rateLimitTimer);
      rateLimitTimer = null;
    }
    set({ activeError: null, rateLimitSeconds: null });
  },

  dismissError: (id) => {
    const current = get().activeError;
    if (!id || (current && current.id === id)) {
      get().clearError();
    }
  },

  startRateLimitCountdown: (seconds) => {
    if (rateLimitTimer) clearInterval(rateLimitTimer);
    set({ rateLimitSeconds: seconds });

    rateLimitTimer = setInterval(() => {
      const remaining = get().rateLimitSeconds;
      if (remaining === null || remaining <= 1) {
        if (rateLimitTimer) clearInterval(rateLimitTimer);
        rateLimitTimer = null;
        set({ rateLimitSeconds: null });
        if (get().activeError?.status === 429) {
          set({ activeError: null });
        }
      } else {
        set({ rateLimitSeconds: remaining - 1 });
      }
    }, 1000);
  },

  startHealthDaemon: (healthUrl = "/api/health", onRecover) => {
    if (healthDaemonTimer) clearInterval(healthDaemonTimer);

    set({
      healthStatus: {
        isChecking: true,
        attempts: 0,
        lastCheckedAt: Date.now(),
        serverReachable: false,
      },
    });

    const checkHealth = async () => {
      try {
        const attempts = get().healthStatus.attempts + 1;
        const res = await fetch(healthUrl, {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
        });

        if (res.ok) {
          // Backend is alive! Cleanly auto-recover
          get().stopHealthDaemon();
          set({
            healthStatus: {
              isChecking: false,
              attempts,
              lastCheckedAt: Date.now(),
              serverReachable: true,
            },
            activeError: null,
          });
          if (onRecover) onRecover();
          return;
        }

        set((state) => ({
          healthStatus: {
            ...state.healthStatus,
            attempts,
            lastCheckedAt: Date.now(),
          },
        }));
      } catch {
        set((state) => ({
          healthStatus: {
            ...state.healthStatus,
            attempts: state.healthStatus.attempts + 1,
            lastCheckedAt: Date.now(),
            serverReachable: false,
          },
        }));
      }
    };

    // Run first check immediately, then poll every 3500ms
    void checkHealth();
    healthDaemonTimer = setInterval(() => void checkHealth(), 3500);
  },

  stopHealthDaemon: () => {
    if (healthDaemonTimer) {
      clearInterval(healthDaemonTimer);
      healthDaemonTimer = null;
    }
    set((state) => ({
      healthStatus: {
        ...state.healthStatus,
        isChecking: false,
      },
    }));
  },
}));
