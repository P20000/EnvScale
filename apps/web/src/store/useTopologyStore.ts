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
import type { K8sDaemonSetData, K8sCronJobData } from "./types/topologyTypes";
import type { WsConnectionStatus, WsTopologyMessage } from "../hooks/useK8sStream";
import type { SelectedTarget } from "../components/drawer/InspectorDrawer";
import { getLayoutedElements } from "../utils/layout";
import { handleWsMessage } from "./slices/topologyWsSlice";
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
  type ApiToken,
  type NotificationItem,
  type K8sIncidentEvent,
  type HistoryAction,
  type DeleteModalState,
  type Cluster,
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

export type { ApiToken, NotificationItem, K8sIncidentEvent, HistoryAction, DeleteModalState };
export {
  extractServices,
  extractPods,
  getPodPrefix,
  generateDynamicEdges,
  syncSelectedNode,
  aggregateNodesWithWorkloads,
  sanitizeManifestSnapshot,
};

export const defaultInitialNodes: Node[] = [];
export const defaultInitialEdges: Edge[] = [];
const defaultClusters: Cluster[] = [];
const defaultInitialTokens: ApiToken[] = [];
const defaultInitialNotifications: NotificationItem[] = [];

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
  cronJobs: K8sCronJobData[];
  incidents: K8sIncidentEvent[];
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
  applyDagreLayout: (direction?: "TB" | "LR") => void;

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
      services: [],
      pods: [],
      ingresses: [],
      replicaSets: [],
      deployments: [],
      daemonSets: [],
      cronJobs: [],
      incidents: [],
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

      removeTarget: (targetId, options) => handleRemoveTarget(get, set, targetId, options),
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
        set({ nodes: applyNodeChanges(changes, get().nodes) });
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
              style: { stroke: "#3f3f46", strokeWidth: 2 },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "#3f3f46",
              },
            },
            get().edges
          ),
        });
      },

      applyDagreLayout: (direction) => {
        const { layoutDirection, showCompletedPods, showSystemNamespaces, selectedNamespaces } = useUIStore.getState();
        const targetDir = direction || layoutDirection || "TB";
        const { rawNodes, nodes, edges, deployments, replicaSets, daemonSets, cronJobs } = get();
        const baseNodes = rawNodes && rawNodes.length > 0 ? rawNodes : nodes;
        if (baseNodes.length === 0 && (!daemonSets || daemonSets.length === 0) && (!cronJobs || cronJobs.length === 0)) return;

        const aggregatedNodes = aggregateNodesWithWorkloads(
          baseNodes,
          showCompletedPods,
          showSystemNamespaces,
          selectedNamespaces,
          deployments,
          replicaSets,
          daemonSets,
          cronJobs
        );

        const dynamicEdges = generateDynamicEdges(aggregatedNodes, edges);

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          aggregatedNodes,
          dynamicEdges,
          targetDir
        );
        set({ nodes: layoutedNodes, edges: layoutedEdges });
      },

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
          services: [],
          pods: [],
          ingresses: [],
          replicaSets: [],
          deployments: [],
          daemonSets: [],
          incidents: [],
          selectedNode: null,
          notifications: [],
          undoStack: [],
          redoStack: [],
          wsStatus: "DISCONNECTED",
          wsLatencyMs: 0,
        });
      },
    }),
    {
      name: "envscale-topology-storage-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        clusters: state.clusters,
        activeCluster: state.activeCluster,
        tokens: state.tokens,
        notifications: state.notifications,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          let needsUpdate = false;
          const parsedClusters: Cluster[] = [];
          for (const c of (state.clusters || [])) {
            if (typeof c === "string") {
              if (c) parsedClusters.push({ id: `migrated-${Date.now()}`, name: c });
              needsUpdate = true;
            } else if (c && c.name) {
              parsedClusters.push(c);
            } else {
              needsUpdate = true;
            }
          }
          
          if (needsUpdate) {
            useTopologyStore.setState({
              clusters: parsedClusters,
              activeCluster: state.activeCluster,
            });
          }
        }
      },
    }
  )
);
