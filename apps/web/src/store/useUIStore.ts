import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useTopologyStore } from "./useTopologyStore";
import type { DeleteModalState } from "./types/topologyTypes";

export interface UIState {
  showCompletedPods: boolean;
  setShowCompletedPods: (show: boolean) => void;

  showSystemNamespaces: boolean;
  setShowSystemNamespaces: (show: boolean) => void;

  selectedNamespaces: string[];
  setSelectedNamespaces: (namespaces: string[] | ((prev: string[]) => string[])) => void;

  layoutDirection: "TB" | "LR";
  setLayoutDirection: (dir: "TB" | "LR") => void;

  expandedWorkloads: Record<string, boolean>;
  toggleWorkloadExpanded: (workloadName: string) => void;

  deleteModal: DeleteModalState;
  openDeleteModal: (targetId: string, targetName: string, targetKind: string, namespace?: string) => void;
  closeDeleteModal: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      showCompletedPods: false,
      showSystemNamespaces: false,
      selectedNamespaces: [],
      layoutDirection: "TB",
      expandedWorkloads: {},
      deleteModal: {
        isOpen: false,
        targetId: "",
        targetName: "",
        targetKind: "",
        namespace: "default",
      },

      setShowCompletedPods: (show) => {
        set({ showCompletedPods: show });
        useTopologyStore.getState().applyDagreLayout();
      },

      setShowSystemNamespaces: (show) => {
        set({ showSystemNamespaces: show });
        useTopologyStore.getState().applyDagreLayout();
      },

      setSelectedNamespaces: (namespaces) => {
        const next = typeof namespaces === "function" ? namespaces(get().selectedNamespaces) : namespaces;
        set({ selectedNamespaces: next });
        useTopologyStore.getState().applyDagreLayout();
      },

      setLayoutDirection: (dir) => {
        set({ layoutDirection: dir });
        useTopologyStore.getState().applyDagreLayout(dir);
      },

      toggleWorkloadExpanded: (workloadName) => {
        const current = get().expandedWorkloads[workloadName];
        set({ expandedWorkloads: { ...get().expandedWorkloads, [workloadName]: !current } });
        useTopologyStore.getState().applyDagreLayout();
      },

      openDeleteModal: (targetId, targetName, targetKind, namespace) => {
        set({
          deleteModal: {
            isOpen: true,
            targetId,
            targetName,
            targetKind,
            namespace: namespace || "default",
          },
        });
      },

      closeDeleteModal: () => {
        set({
          deleteModal: {
            isOpen: false,
            targetId: "",
            targetName: "",
            targetKind: "",
            namespace: "default",
          },
        });
      },
    }),
    {
      name: "envscale-ui-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        showCompletedPods: state.showCompletedPods,
        showSystemNamespaces: state.showSystemNamespaces,
        layoutDirection: state.layoutDirection,
      }),
    }
  )
);
