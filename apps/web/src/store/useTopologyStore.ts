import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useUIStore } from "./useUIStore";
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  MarkerType,
} from "@xyflow/react";

import type { K8sPodData } from "../components/canvas/K8sPod";
import type { K8sServiceData } from "../components/canvas/K8sService";
import type { K8sIngressData } from "../components/canvas/K8sIngress";
import type { K8sReplicaSetData, K8sDeploymentData } from "./helpers/rolloutHelpers";
import type { K8sDaemonSetData, K8sCronJobData, K8sJobData } from "./types/topologyTypes";
import type { WsConnectionStatus, WsTopologyMessage } from "../hooks/useK8sStream";
import type { SelectedTarget } from "../components/drawer/InspectorDrawer";
import { handleWsMessage } from "./slices/topologyWsSlice";
import { handleApplyDagreLayout } from "./slices/topologyLayoutSlice";
import {
  handleUndoAction,
  handleRedoAction,
  handleRemoveTarget,
  handleCreateNode,
} from "./slices/topologyActionsSlice";
import {
  handleUpsertService,
  handleUpsertPod,
  handleSetServices,
} from "./slices/topologyCrudSlice";
import { handleAddToken, handleAddNotification } from "./slices/topologyNotifSlice";
import {
  type ApiToken, type NotificationItem, type K8sIncidentEvent, type HistoryAction, type DeleteModalState,
  type Cluster, type K8sPVCData, type K8sPVData, type K8sConfigMapData, type K8sSecretData, type ChaosFaultEvent,
  type K8sHPAData, type K8sNetworkPolicyData, type K8sPDBData,
} from "./types/topologyTypes";
import {
  extractServices,
  extractPods,
  getPodPrefix,
  generateDynamicEdges,
  syncSelectedNode,
  aggregateNodesWithWorkloads,
  sanitizeManifestSnapshot,
} from "./helpers/topologyHelpers";

export type { ApiToken, NotificationItem, K8sIncidentEvent, HistoryAction, DeleteModalState, ChaosFaultEvent };
export { extractServices, extractPods, getPodPrefix, generateDynamicEdges, syncSelectedNode, aggregateNodesWithWorkloads, sanitizeManifestSnapshot };

export const defaultInitialNodes: Node[] = [];
export const defaultInitialEdges: Edge[] = [];
const defaultClusters: Cluster[] = [], defaultInitialTokens: ApiToken[] = [], defaultInitialNotifications: NotificationItem[] = [];

export interface TopologyState {
  clusters: Cluster[];
  activeCluster: string;
  clusterCpuCores: number;
  clusterMemoryGB: number;
  rawNodes: Node[];
  nodes: Node[];
  edges: Edge[];
  services: K8sServiceData[];
  pods: K8sPodData[];
  ingresses: K8sIngressData[];
  replicaSets: K8sReplicaSetData[];
  deployments: K8sDeploymentData[];
  daemonSets: K8sDaemonSetData[];
  cronJobs: K8sCronJobData[]; jobs: K8sJobData[]; pvcs: K8sPVCData[];
  pvs: K8sPVData[];
  configMaps: K8sConfigMapData[];
  secrets: K8sSecretData[];
  hpas: K8sHPAData[];
  networkPolicies: K8sNetworkPolicyData[];
  pdbs: K8sPDBData[];
  incidents: K8sIncidentEvent[];
  activeChaosFaults: Record<string, ChaosFaultEvent>;
  selectedNode: SelectedTarget;
  tokens: ApiToken[];
  notifications: NotificationItem[];
  wsStatus: WsConnectionStatus;
  wsLatencyMs: number;

  undoStack: HistoryAction[];
  redoStack: HistoryAction[];
  undoAction: () => Promise<void>;
  redoAction: () => Promise<void>;

  setSelectedNode: (target: SelectedTarget) => void;
  clearSelectedNode: () => void;

  upsertNode: (node: Node) => void;
  removeNode: (nodeId: string) => void;
  upsertService: (serviceData: Partial<K8sServiceData> & { name: string }) => void;
  removeService: (serviceId: string) => void;
  upsertPod: (podData: Partial<K8sPodData> & { name: string }) => void;
  removePod: (podId: string) => void;

  setServices: (services: K8sServiceData[] | ((prev: K8sServiceData[]) => K8sServiceData[])) => void;
  setPods: (pods: K8sPodData[] | ((prev: K8sPodData[]) => K8sPodData[])) => void;
  setIncidents: (incidents: K8sIncidentEvent[] | ((prev: K8sIncidentEvent[]) => K8sIncidentEvent[])) => void;

  setActiveCluster: (cluster: string) => void;
  setClusters: (clusters: Cluster[]) => void;
  addCluster: (cluster: Cluster) => void;
  deleteCluster: (clusterId: string) => void;
  deleteNode: (nodeId: string) => void;

  removeTarget: (targetId: string, options?: { skipHistory?: boolean; skipApi?: boolean }) => void;

  createNode: (type: "k8sPod" | "k8sWorker" | "k8sService", customName?: string) => void;

  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  userNodePositions: Record<string, { x: number; y: number }>;
  setUserNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setUserNodePositions: (positions: Record<string, { x: number; y: number }>) => void;
  clearUserNodePositions: () => void;
  applyDagreLayout: (direction?: "TB" | "LR", options?: { resetUserPositions?: boolean }) => void;

  tokensCount: number;
  addToken: (name?: string, tokenStr?: string) => ApiToken;
  generateToken: (name?: string, tokenStr?: string) => ApiToken;
  revokeToken: (id: string) => void;

  notificationsCount: number;
  addNotification: (title: string, message: string, severity?: "CRITICAL" | "WARNING" | "INFO") => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;

  setWsStatus: (status: WsConnectionStatus, latencyMs?: number) => void;
  processWsMessage: (msg: WsTopologyMessage) => void;
  applyDelta: (msg: WsTopologyMessage) => void;

  // Login → WS reconnect bridge
  wsReconnectTick: number;
  triggerWsReconnect: () => void;

  resetStore: () => void;
}

export const useTopologyStore = create<TopologyState>()(
  persist(
    (set, get) => ({
      clusters: defaultClusters,
      activeCluster: "",
      clusterCpuCores: 0,
      clusterMemoryGB: 0,
      rawNodes: defaultInitialNodes,
      nodes: defaultInitialNodes,
      edges: defaultInitialEdges,
      userNodePositions: {},
      services: [],
      pods: [],
      ingresses: [],
      replicaSets: [],
      deployments: [],
      daemonSets: [],
      cronJobs: [],
      jobs: [],
      pvcs: [],
      pvs: [],
      configMaps: [],
      secrets: [],
      hpas: [],
      networkPolicies: [],
      pdbs: [],
      incidents: [],
      activeChaosFaults: {},
      selectedNode: null,
      tokens: defaultInitialTokens,
      notifications: defaultInitialNotifications,
      wsStatus: "DISCONNECTED",
      wsLatencyMs: 0,
      wsReconnectTick: 0,
      undoStack: [],
      redoStack: [],

      undoAction: async () => handleUndoAction(get, set),
      redoAction: async () => handleRedoAction(get, set),

      setSelectedNode: (target) => {
        if (!target) {
          set({ selectedNode: null });
          return;
        }
        const synced = syncSelectedNode(get().nodes, target);
        set({ selectedNode: synced });
      },
      clearSelectedNode: () => set({ selectedNode: null }),

      setActiveCluster: (cluster) => set({ activeCluster: cluster }),
      setClusters: (clusters) =>
        set((state) => ({
          clusters,
          activeCluster: clusters.some((c) => c.id === state.activeCluster)
            ? state.activeCluster
            : clusters[0]?.id || "",
        })),

      addCluster: (cluster) => {
        if (!cluster || !cluster.id || !cluster.name) return;
        const currentClusters = get().clusters;
        
        if (currentClusters.some((c) => c.id === cluster.id)) {
          return;
        }

        const newNotif: NotificationItem = {
          id: `notif-${Date.now()}`,
          title: "New Cluster Connected",
          message: `Cluster ${cluster.name} successfully registered to workspace`,
          time: "Just now",
          severity: "INFO",
          read: false,
          cluster: cluster.name,
        };
        set({
          clusters: [...currentClusters, cluster],
          activeCluster: cluster.id,
          notifications: [newNotif, ...get().notifications].slice(0, 50),
        });
      },

      upsertNode: (node) => {
        const current = get().nodes;
        const idx = current.findIndex((n) => n.id === node.id);
        const updated = idx >= 0 ? [...current] : [...current, node];
        if (idx >= 0) updated[idx] = node;
        set({
          nodes: updated,
          services: extractServices(updated),
          pods: extractPods(updated),
          selectedNode: syncSelectedNode(updated, get().selectedNode),
        });
      },

      removeTarget: (targetId, options) => {
        if (get().userNodePositions[targetId]) {
          const nextPos = { ...get().userNodePositions };
          delete nextPos[targetId];
          set({ userNodePositions: nextPos });
        }
        return handleRemoveTarget(get, set, targetId, options);
      },
      removeNode: (nodeId) => get().removeTarget(nodeId),

      upsertService: (serviceData) => handleUpsertService(get, set, serviceData),
      removeService: (serviceId) => get().removeTarget(serviceId),

      upsertPod: (podData) => handleUpsertPod(get, set, podData),
      removePod: (podId) => get().removeTarget(podId),

      setServices: (servicesInput) => handleSetServices(get, set, servicesInput),

      setPods: (pods) =>
        set((state) => ({
          pods: typeof pods === "function" ? pods(state.pods) : pods,
        })),

      setIncidents: (incidents) =>
        set((state) => ({
          incidents: typeof incidents === "function" ? incidents(state.incidents) : incidents,
        })),

      createNode: (type, customName) => handleCreateNode(get, set, type, customName),

      deleteCluster: (clusterId) => {
        const clusterToDelete = get().clusters.find((c) => c.id === clusterId);
        if (!clusterToDelete) return;

        const updatedClusters = get().clusters.filter((c) => c.id !== clusterId);
        const wasActive = get().activeCluster === clusterId;
        const nextActive = wasActive
          ? updatedClusters[0]?.id || ""
          : get().activeCluster;

        if (wasActive) {
          // Active cluster was deleted — clear all topology state so the canvas
          // doesn't show stale nodes from the old cluster.
          set({
            clusters: updatedClusters,
            activeCluster: nextActive,
            rawNodes: [],
            nodes: [],
            edges: [],
            services: [],
            pods: [],
            ingresses: [],
            replicaSets: [],
            deployments: [],
            daemonSets: [],
            cronJobs: [],
            jobs: [],
            incidents: [],
            selectedNode: null,
            wsReconnectTick: get().wsReconnectTick + 1,
          });
        } else {
          // Non-active cluster deleted — just remove it from the list.
          set({ clusters: updatedClusters });
        }
      },

      deleteNode: (nodeId) => {
        const currentRaw = get().rawNodes || [];
        const currentNodes = get().nodes || [];
        const targetNode =
          currentRaw.find(
            (n) => n.id === nodeId || (n.data as Record<string, unknown>)?.name === nodeId
          ) ||
          currentNodes.find(
            (n) => n.id === nodeId || (n.data as Record<string, unknown>)?.name === nodeId
          );

        if (targetNode) {
          const resData = (targetNode.data as Record<string, unknown>) || {};
          const resName = String(resData.name || targetNode.id);
          const resKind = targetNode.type?.replace("k8s", "") || "Resource";
          const ns = String(resData.namespace || "default");

          useUIStore.getState().openDeleteModal(nodeId, resName, resKind, ns);
        } else {
          get().removeTarget(nodeId);
        }
      },

      setNodes: (nodesInput) => {
        const nextNodes = typeof nodesInput === "function" ? nodesInput(get().nodes) : nodesInput;
        set({
          nodes: nextNodes,
          services: extractServices(nextNodes),
          pods: extractPods(nextNodes),
        });
      },

      setEdges: (edgesInput) => {
        const nextEdges = typeof edgesInput === "function" ? edgesInput(get().edges) : edgesInput;
        set({ edges: nextEdges });
      },

      onNodesChange: (changes) => {
        const removedChanges = changes.filter((c) => c.type === "remove");
        if (removedChanges.length > 0) {
          removedChanges.forEach((c) => get().removeTarget(c.id));
          return;
        }
        const nextNodes = applyNodeChanges(changes, get().nodes);
        const posChanges = changes.filter((c) => c.type === "position" && c.position && c.dragging === false);
        if (posChanges.length > 0) {
          const newPos = { ...get().userNodePositions };
          posChanges.forEach((c) => {
            if (c.type === "position" && c.position) {
              newPos[c.id] = { x: Math.round(c.position.x), y: Math.round(c.position.y) };
            }
          });
          set({ nodes: nextNodes, userNodePositions: newPos });
        } else {
          set({ nodes: nextNodes });
        }
      },

      onEdgesChange: (changes) => {
        set({ edges: applyEdgeChanges(changes, get().edges) });
      },

      onConnect: (connection) => {
        set({
          edges: addEdge(
            {
              ...connection,
              type: "smoothstep",
              animated: true,
              style: { stroke: "#515660", strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "#515660",
              },
            },
            get().edges
          ),
        });
      },

      setUserNodePosition: (nodeId, position) => {
        set((state) => ({
          userNodePositions: {
            ...state.userNodePositions,
            [nodeId]: { x: Math.round(position.x), y: Math.round(position.y) },
          },
        }));
      },

      setUserNodePositions: (positions) => {
        set((state) => ({
          userNodePositions: {
            ...state.userNodePositions,
            ...positions,
          },
        }));
      },

      clearUserNodePositions: () => set({ userNodePositions: {} }),

      applyDagreLayout: (direction, options) => handleApplyDagreLayout(get, set, direction, options),

      tokensCount: 0,
      addToken: (name = "Default Token", tokenStr) => handleAddToken(set, name, tokenStr),

      revokeToken: (id) => {
        set((state) => ({ tokens: state.tokens.filter((t) => t.id !== id) }));
      },

      notificationsCount: 0,
      addNotification: (title, message, severity = "INFO") =>
        handleAddNotification(get, set, title, message, severity),

      markNotificationRead: (id) => set((state) => ({
        notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      })),
      markAllNotificationsRead: () => set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
      })),
      generateToken: (name, tokenStr) => get().addToken(name, tokenStr),
      clearNotifications: () => set({ notifications: [] }),
      setWsStatus: (status, latencyMs) => {
        const currentMs = get().wsLatencyMs;
        const validMs = latencyMs && latencyMs > 0 && latencyMs < 200
          ? latencyMs
          : (currentMs > 0 && currentMs < 200 ? currentMs : 8);
        set({ wsStatus: status, wsLatencyMs: status === "CONNECTED" ? validMs : 0 });
      },
      processWsMessage: (msg) => handleWsMessage(get(), set, msg),
      applyDelta: (msg) => handleWsMessage(get(), set, msg),
      triggerWsReconnect: () => set((state) => ({ wsReconnectTick: state.wsReconnectTick + 1 })),
      resetStore: () => {
        try {
          localStorage.removeItem("envscale-topology-storage-v2");
        } catch (err) {
          console.warn("Failed to reset localStorage topology key:", err);
        }
        set({
          clusters: [],
          activeCluster: "",
          clusterCpuCores: 0,
          clusterMemoryGB: 0,
          rawNodes: [],
          nodes: [],
          edges: [],
          userNodePositions: {},
          services: [],
          pods: [],
          ingresses: [],
          replicaSets: [],
          deployments: [],
          daemonSets: [],
          cronJobs: [], jobs: [], pvcs: [], hpas: [], networkPolicies: [], pdbs: [],
          incidents: [], activeChaosFaults: {}, selectedNode: null, notifications: [],
          undoStack: [], redoStack: [], wsStatus: "DISCONNECTED", wsLatencyMs: 0,
        });
      },
    }),
    {
      name: "envscale-topology-storage-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tokens: state.tokens,
        notifications: state.notifications,
        userNodePositions: state.userNodePositions,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const isAuth = Boolean(typeof window !== "undefined" && (localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token")));
        if (!isAuth) {
          useTopologyStore.setState({ clusters: [], activeCluster: "", nodes: [], edges: [], pods: [], services: [] });
        }
      },
    }
  )
);
