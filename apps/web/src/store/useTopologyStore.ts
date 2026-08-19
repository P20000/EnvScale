import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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
import type { K8sNodeData } from "../components/canvas/K8sNode";
import type { K8sServiceData } from "../components/canvas/K8sService";
import type { WsConnectionStatus, WsTopologyMessage } from "../hooks/useK8sStream";
import { getLayoutedElements } from "../utils/layout";

export interface ApiToken {
  id: string;
  token: string;
  name: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  read: boolean;
  cluster?: string;
}

export const defaultInitialNodes: Node[] = [
  // Services
  {
    id: "svc-ingress",
    type: "k8sService",
    position: { x: 50, y: 180 },
    data: {
      name: "ingress-gateway",
      type: "Ingress",
      port: ":443",
    } as K8sServiceData,
  },
  {
    id: "svc-api",
    type: "k8sService",
    position: { x: 300, y: 180 },
    data: {
      name: "api-router",
      type: "ClusterIP",
      port: ":8080",
    } as K8sServiceData,
  },

  // Pods
  {
    id: "pod-auth-1",
    type: "k8sPod",
    position: { x: 580, y: 60 },
    data: {
      name: "auth-service-7f8d-a1",
      namespace: "default",
      status: "Running",
      restarts: 0,
      ip: "10.244.0.12",
      cpuUsage: "34 mcores",
      memoryUsage: "128 MiB",
    } as K8sPodData,
  },
  {
    id: "pod-auth-2",
    type: "k8sPod",
    position: { x: 580, y: 170 },
    data: {
      name: "auth-service-7f8d-b2",
      namespace: "default",
      status: "Running",
      restarts: 1,
      ip: "10.244.0.15",
      cpuUsage: "42 mcores",
      memoryUsage: "145 MiB",
    } as K8sPodData,
  },
  {
    id: "pod-payment-1",
    type: "k8sPod",
    position: { x: 580, y: 280 },
    data: {
      name: "payment-api-x2k4",
      namespace: "default",
      status: "CrashLoopBackOff",
      restarts: 5,
      ip: "10.244.0.18",
      cpuUsage: "180 mcores",
      memoryUsage: "480 MiB",
    } as K8sPodData,
  },

  // Worker Nodes
  {
    id: "node-worker-1",
    type: "k8sWorker",
    position: { x: 880, y: 50 },
    data: {
      name: "minikube-worker-1",
      ip: "192.168.49.2",
      osImage: "Ubuntu 22.04 LTS",
      cpuCapacity: "4 cores",
      memoryCapacity: "8 GiB",
      cpuPct: 42,
      memoryPct: 68,
      status: "Ready",
    } as K8sNodeData,
  },
  {
    id: "node-worker-2",
    type: "k8sWorker",
    position: { x: 880, y: 260 },
    data: {
      name: "minikube-worker-2",
      ip: "192.168.49.3",
      osImage: "Ubuntu 22.04 LTS",
      cpuCapacity: "4 cores",
      memoryCapacity: "8 GiB",
      cpuPct: 88,
      memoryPct: 92,
      status: "Ready",
    } as K8sNodeData,
  },
];

export const defaultInitialEdges: Edge[] = [
  {
    id: "e-ingress-api",
    source: "svc-ingress",
    target: "svc-api",
    type: "smoothstep",
    animated: true,
    style: { stroke: "#3f3f46", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#3f3f46",
    },
  },
  {
    id: "e-api-pod1",
    source: "svc-api",
    target: "pod-auth-1",
    type: "smoothstep",
    animated: true,
    style: { stroke: "#3f3f46", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#3f3f46",
    },
  },
  {
    id: "e-api-pod2",
    source: "svc-api",
    target: "pod-auth-2",
    type: "smoothstep",
    animated: true,
    style: { stroke: "#3f3f46", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#3f3f46",
    },
  },
  {
    id: "e-api-pod3",
    source: "svc-api",
    target: "pod-payment-1",
    type: "smoothstep",
    animated: false,
    style: { stroke: "#ef4444", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#ef4444",
    },
  },
  {
    id: "e-pod1-worker1",
    source: "pod-auth-1",
    target: "node-worker-1",
    type: "smoothstep",
    style: { stroke: "#3f3f46", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#3f3f46",
    },
  },
  {
    id: "e-pod2-worker1",
    source: "pod-auth-2",
    target: "node-worker-1",
    type: "smoothstep",
    style: { stroke: "#3f3f46", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#3f3f46",
    },
  },
  {
    id: "e-pod3-worker2",
    source: "pod-payment-1",
    target: "node-worker-2",
    type: "smoothstep",
    style: { stroke: "#3f3f46", strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#3f3f46",
    },
  },
];

const defaultClusters = ["minikube-prod", "staging-us-east", "eks-production"];

const defaultInitialTokens: ApiToken[] = [
  {
    id: "token-1",
    name: "Production Gateway Agent",
    token: "envscale_live_sk_89f410a7c92e4b316d8a",
    createdAt: "Aug 19, 2026",
  },
];

const defaultInitialNotifications: NotificationItem[] = [
  {
    id: "notif-1",
    title: "Critical Incident Detected",
    message: "CrashLoopBackOff — payment-api exited with code 137 (OOMKilled)",
    time: "2 mins ago",
    severity: "CRITICAL",
    read: false,
    cluster: "minikube-prod",
  },
  {
    id: "notif-2",
    title: "High Latency Warning",
    message: "P99 latency on ingress-gateway exceeded 450ms threshold",
    time: "18 mins ago",
    severity: "WARNING",
    read: false,
    cluster: "minikube-prod",
  },
  {
    id: "notif-3",
    title: "Pod Restart Threshold",
    message: "payment-api restarted 5 times in the last 15 minutes",
    time: "42 mins ago",
    severity: "WARNING",
    read: false,
    cluster: "staging-us-east",
  },
  {
    id: "notif-4",
    title: "New Cluster Connected",
    message: "Cluster eks-production successfully registered to workspace",
    time: "2 hours ago",
    severity: "INFO",
    read: true,
    cluster: "eks-production",
  },
];

interface TopologyState {
  clusters: string[];
  activeCluster: string;
  nodes: Node[];
  edges: Edge[];
  tokens: ApiToken[];
  notifications: NotificationItem[];
  wsStatus: WsConnectionStatus;
  wsLatencyMs: number;

  // Actions
  setActiveCluster: (cluster: string) => void;
  addCluster: (clusterName: string) => void;
  deleteCluster: (clusterName: string) => void;
  deleteNode: (nodeId: string) => void;
  createNode: (type: "k8sPod" | "k8sWorker" | "k8sService", name?: string) => void;

  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;

  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;

  // Dagre Auto-Layout Action
  applyDagreLayout: (direction?: "TB" | "LR") => void;

  // WebSocket Actions
  setWsStatus: (status: WsConnectionStatus, latencyMs?: number) => void;
  processWsMessage: (msg: WsTopologyMessage) => void;

  // Token Actions
  generateToken: (name?: string) => void;
  revokeToken: (id: string) => void;

  // Notification Actions
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  resetTopology: () => void;
}

export const useTopologyStore = create<TopologyState>()(
  persist(
    (set, get) => ({
      clusters: defaultClusters,
      activeCluster: "minikube-prod",
      nodes: defaultInitialNodes,
      edges: defaultInitialEdges,
      tokens: defaultInitialTokens,
      notifications: defaultInitialNotifications,
      wsStatus: "DISCONNECTED",
      wsLatencyMs: 12,

      setActiveCluster: (cluster) => set({ activeCluster: cluster }),

      addCluster: (clusterName) => {
        const trimmed = clusterName.trim();
        if (!trimmed) return;

        const currentClusters = get().clusters;
        const updatedClusters = currentClusters.includes(trimmed)
          ? currentClusters
          : [...currentClusters, trimmed];

        const timestamp = Date.now();
        const clusterNodeId = `node-cluster-${timestamp}`;
        const randomIp = `192.168.${Math.floor(Math.random() * 100 + 1)}.${Math.floor(Math.random() * 200 + 2)}`;

        const newWorkerNode: Node = {
          id: clusterNodeId,
          type: "k8sWorker",
          position: {
            x: 400 + (get().nodes.length % 4) * 80 + Math.random() * 50,
            y: 120 + Math.random() * 100,
          },
          data: {
            name: trimmed,
            ip: randomIp,
            osImage: "Ubuntu 22.04 LTS",
            cpuCapacity: "4 cores",
            memoryCapacity: "8 GiB",
            cpuPct: Math.floor(Math.random() * 40 + 20),
            memoryPct: Math.floor(Math.random() * 40 + 30),
            status: "Ready",
          } as K8sNodeData,
        };

        const podNodeId = `pod-${timestamp}`;
        const podName = `${trimmed.toLowerCase().replace(/[^a-z0-9]/g, "-")}-workload`;
        const newPodNode: Node = {
          id: podNodeId,
          type: "k8sPod",
          position: {
            x: newWorkerNode.position.x - 240,
            y: newWorkerNode.position.y + 20,
          },
          data: {
            name: podName,
            namespace: "default",
            status: "Running",
            restarts: 0,
            ip: `10.244.${Math.floor(Math.random() * 10 + 1)}.${Math.floor(Math.random() * 200 + 10)}`,
            cpuUsage: "28 mcores",
            memoryUsage: "96 MiB",
          } as K8sPodData,
        };

        const newEdge: Edge = {
          id: `e-${podNodeId}-${clusterNodeId}`,
          source: podNodeId,
          target: clusterNodeId,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#3f3f46", strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#3f3f46",
          },
        };

        const newNotif: NotificationItem = {
          id: `notif-${timestamp}`,
          title: "New Cluster Connected",
          message: `Cluster ${trimmed} successfully registered to workspace`,
          time: "Just now",
          severity: "INFO",
          read: false,
          cluster: trimmed,
        };

        set({
          clusters: updatedClusters,
          activeCluster: trimmed,
          nodes: [...get().nodes, newWorkerNode, newPodNode],
          edges: [...get().edges, newEdge],
          notifications: [newNotif, ...get().notifications],
        });
      },

      createNode: (type, customName) => {
        const timestamp = Date.now();
        const count = get().nodes.filter((n) => n.type === type).length + 1;
        const posX = 200 + Math.random() * 350;
        const posY = 150 + Math.random() * 250;

        let newNode: Node;

        if (type === "k8sPod") {
          newNode = {
            id: `pod-${timestamp}`,
            type: "k8sPod",
            position: { x: posX, y: posY },
            data: {
              name: customName || `app-workload-${count}`,
              namespace: "default",
              status: "Running",
              restarts: 0,
              ip: `10.244.0.${Math.floor(Math.random() * 200 + 10)}`,
              cpuUsage: "32 mcores",
              memoryUsage: "110 MiB",
            } as K8sPodData,
          };
        } else if (type === "k8sWorker") {
          newNode = {
            id: `worker-${timestamp}`,
            type: "k8sWorker",
            position: { x: posX, y: posY },
            data: {
              name: customName || `k8s-node-${count}`,
              ip: `192.168.49.${Math.floor(Math.random() * 200 + 10)}`,
              osImage: "Ubuntu 22.04 LTS",
              cpuCapacity: "4 cores",
              memoryCapacity: "8 GiB",
              cpuPct: 35,
              memoryPct: 50,
              status: "Ready",
            } as K8sNodeData,
          };
        } else {
          newNode = {
            id: `service-${timestamp}`,
            type: "k8sService",
            position: { x: posX, y: posY },
            data: {
              name: customName || `service-router-${count}`,
              type: "ClusterIP",
              port: `:80${Math.floor(Math.random() * 80 + 10)}`,
            } as K8sServiceData,
          };
        }

        set({
          nodes: [...get().nodes, newNode],
        });
      },

      deleteCluster: (clusterName) => {
        const updatedClusters = get().clusters.filter((c) => c !== clusterName);
        const nextActive =
          get().activeCluster === clusterName
            ? updatedClusters[0] || "default-cluster"
            : get().activeCluster;

        const remainingNodes = get().nodes.filter((node) => {
          const name = (node.data as Record<string, unknown>)?.name;
          return name !== clusterName;
        });

        const remainingNodeIds = new Set(remainingNodes.map((n) => n.id));
        const remainingEdges = get().edges.filter(
          (edge) => remainingNodeIds.has(edge.source) && remainingNodeIds.has(edge.target)
        );

        set({
          clusters: updatedClusters,
          activeCluster: nextActive,
          nodes: remainingNodes,
          edges: remainingEdges,
        });
      },

      deleteNode: (nodeId) => {
        const remainingNodes = get().nodes.filter((n) => n.id !== nodeId);
        const remainingNodeIds = new Set(remainingNodes.map((n) => n.id));
        const remainingEdges = get().edges.filter(
          (e) => remainingNodeIds.has(e.source) && remainingNodeIds.has(e.target)
        );
        set({
          nodes: remainingNodes,
          edges: remainingEdges,
        });
      },

      setNodes: (nodesInput) => {
        const nextNodes = typeof nodesInput === "function" ? nodesInput(get().nodes) : nodesInput;
        set({ nodes: nextNodes });
      },

      setEdges: (edgesInput) => {
        const nextEdges = typeof edgesInput === "function" ? edgesInput(get().edges) : edgesInput;
        set({ edges: nextEdges });
      },

      onNodesChange: (changes) => {
        const updatedNodes = applyNodeChanges(changes, get().nodes);
        const remainingNodeIds = new Set(updatedNodes.map((n) => n.id));
        const updatedEdges = get().edges.filter(
          (e) => remainingNodeIds.has(e.source) && remainingNodeIds.has(e.target)
        );
        set({
          nodes: updatedNodes,
          edges: updatedEdges,
        });
      },

      onEdgesChange: (changes) => {
        set({
          edges: applyEdgeChanges(changes, get().edges),
        });
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

      applyDagreLayout: (direction = "TB") => {
        const { nodes, edges } = get();
        if (nodes.length === 0) return;
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          nodes,
          edges,
          direction
        );
        set({ nodes: layoutedNodes, edges: layoutedEdges });
      },

      setWsStatus: (status, latencyMs) => {
        set({
          wsStatus: status,
          wsLatencyMs: latencyMs ?? get().wsLatencyMs,
        });
      },

      processWsMessage: (msg) => {
        const { payload, type } = msg;
        if (!payload) return;

        if (type === "EVENT_TOPOLOGY_SNAPSHOT" && payload.nodes) {
          set({
            nodes: payload.nodes,
            edges: payload.edges || get().edges,
          });
        } else if (
          (type === "EVENT_POD_ADDED" || type === "EVENT_POD_MODIFIED") &&
          payload.pod
        ) {
          const pod = payload.pod;
          const existing = get().nodes.filter((n) => n.id !== pod.id);
          set({ nodes: [...existing, pod] });
        } else if (
          (type === "EVENT_NODE_ADDED" || type === "EVENT_NODE_MODIFIED") &&
          payload.node
        ) {
          const node = payload.node;
          const existing = get().nodes.filter((n) => n.id !== node.id);
          set({ nodes: [...existing, node] });
        } else if (
          (type === "EVENT_SERVICE_ADDED" || type === "EVENT_SERVICE_MODIFIED") &&
          payload.service
        ) {
          const service = payload.service;
          const existing = get().nodes.filter((n) => n.id !== service.id);
          set({ nodes: [...existing, service] });
        } else if (type === "EVENT_POD_DELETED" && payload.podId) {
          get().deleteNode(payload.podId);
        } else if (type === "EVENT_NODE_DELETED" && payload.nodeId) {
          get().deleteNode(payload.nodeId);
        } else if (type === "EVENT_SERVICE_DELETED" && payload.serviceId) {
          get().deleteNode(payload.serviceId);
        }
      },

      generateToken: (tokenName) => {
        const randomHex = Array.from({ length: 32 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join("");
        const newToken: ApiToken = {
          id: `token-${Date.now()}`,
          name: tokenName || "Workspace Integration Key",
          token: `envscale_${randomHex}`,
          createdAt: new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          }),
        };
        set({ tokens: [newToken, ...get().tokens] });
      },

      revokeToken: (id) => {
        set({ tokens: get().tokens.filter((t) => t.id !== id) });
      },

      markNotificationRead: (id) => {
        set({
          notifications: get().notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        });
      },

      markAllNotificationsRead: () => {
        set({
          notifications: get().notifications.map((n) => ({ ...n, read: true })),
        });
      },

      resetTopology: () => {
        set({
          clusters: defaultClusters,
          activeCluster: "minikube-prod",
          nodes: defaultInitialNodes,
          edges: defaultInitialEdges,
          tokens: defaultInitialTokens,
          notifications: defaultInitialNotifications,
        });
      },
    }),
    {
      name: "envscale-topology-storage",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
