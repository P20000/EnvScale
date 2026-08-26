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

const defaultRules: AlertRule[] = [];

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
