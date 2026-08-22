import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AlertRule } from "../types/alerts";

interface AlertState {
  alertRules: AlertRule[];
  selectedAlertRule: AlertRule | null;
  addAlertRule: (rule: Omit<AlertRule, "id" | "createdAt" | "updatedAt">) => void;
  updateAlertRule: (id: string, updates: Partial<Omit<AlertRule, "id" | "createdAt" | "updatedAt">>) => void;
  deleteAlertRule: (id: string) => void;
  toggleAlertRule: (id: string) => void;
  setSelectedAlertRule: (rule: AlertRule | null) => void;
}

const defaultRules: AlertRule[] = [
  {
    id: "rule-1",
    name: "High CPU Usage Warning",
    metric: "cpu",
    operator: "greater_than",
    threshold: 80,
    duration: "5 minutes",
    namespace: "all",
    severity: "warning",
    enabled: true,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "rule-2",
    name: "Auth Service Pod Crash",
    metric: "pod_crash",
    operator: "greater_than_or_equal",
    threshold: 3,
    duration: "Immediately",
    namespace: "default",
    severity: "critical",
    enabled: true,
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "rule-3",
    name: "Database Memory Threshold",
    metric: "memory",
    operator: "greater_than",
    threshold: 90,
    duration: "10 minutes",
    namespace: "database",
    severity: "critical",
    enabled: false,
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export const useAlertStore = create<AlertState>()(
  persist(
    (set) => ({
      alertRules: defaultRules,
      selectedAlertRule: null,

      addAlertRule: (newRuleData) => {
        const now = new Date().toISOString();
        const newRule: AlertRule = {
          ...newRuleData,
          id: `rule-${Date.now()}`,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          alertRules: [newRule, ...state.alertRules],
        }));
      },

      updateAlertRule: (id, updates) => {
        const now = new Date().toISOString();
        set((state) => ({
          alertRules: state.alertRules.map((rule) =>
            rule.id === id
              ? {
                  ...rule,
                  ...updates,
                  updatedAt: now,
                }
              : rule
          ),
          selectedAlertRule:
            state.selectedAlertRule?.id === id
              ? { ...state.selectedAlertRule, ...updates, updatedAt: now }
              : state.selectedAlertRule,
        }));
      },

      deleteAlertRule: (id) => {
        set((state) => ({
          alertRules: state.alertRules.filter((rule) => rule.id !== id),
          selectedAlertRule: state.selectedAlertRule?.id === id ? null : state.selectedAlertRule,
        }));
      },

      toggleAlertRule: (id) => {
        const now = new Date().toISOString();
        set((state) => ({
          alertRules: state.alertRules.map((rule) =>
            rule.id === id
              ? {
                  ...rule,
                  enabled: !rule.enabled,
                  updatedAt: now,
                }
              : rule
          ),
        }));
      },

      setSelectedAlertRule: (rule) => set({ selectedAlertRule: rule }),
    }),
    {
      name: "envscale-alert-rules",
    }
  )
);
