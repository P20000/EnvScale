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

import type { K8sIngressData, IngressRuleData } from "../components/canvas/K8sIngress";
import type { WsConnectionStatus, WsTopologyMessage } from "../hooks/useK8sStream";
import type { SelectedTarget } from "../components/drawer/InspectorDrawer";
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

export const defaultInitialNodes: Node[] = [];
export const defaultInitialEdges: Edge[] = [];
const defaultClusters: string[] = [];
const defaultInitialTokens: ApiToken[] = [];
const defaultInitialNotifications: NotificationItem[] = [];

export const extractServices = (nodes: Node[]): K8sServiceData[] =>
  nodes
    .filter((n) => n.type === "k8sService" && Boolean(n.data))
    .map((n) => n.data as K8sServiceData);

export const extractPods = (nodes: Node[]): K8sPodData[] =>
  nodes
    .filter((n) => n.type === "k8sPod" && Boolean(n.data))
    .map((n) => n.data as K8sPodData);

export const generateDynamicEdges = (nodes: Node[], currentEdges: Edge[]): Edge[] => {
  const baseEdges = currentEdges.filter((e) => !e.id.startsWith("e-sys-"));
  const sysEdges: Edge[] = [];
  
  const pods = nodes.filter((n) => n.type === "k8sPod");
  const services = nodes.filter((n) => n.type === "k8sService");
  const ingresses = nodes.filter((n) => n.type === "k8sIngress");

  // 1. Ingress -> Service (Grouped Multi-Path / Multi-Port edge labels)
  ingresses.forEach((ing) => {
    const rules = (ing.data as K8sIngressData).rules as IngressRuleData[];
    if (rules && rules.length > 0) {
      const rulesBySvc = new Map<string, IngressRuleData[]>();
      rules.forEach((rule) => {
        if (rule.serviceName) {
          const svc = services.find(
            (s) => s.id === rule.serviceName || (s.data as K8sServiceData).name === rule.serviceName
          );
          if (svc) {
            const existing = rulesBySvc.get(svc.id) || [];
            existing.push(rule);
            rulesBySvc.set(svc.id, existing);
          }
        }
      });

      rulesBySvc.forEach((svcRules, svcId) => {
        const formattedPaths = svcRules.map((r) => {
          const pathStr = r.path || "/";
          const portStr = r.servicePort ? `:${r.servicePort}` : "";
          return `${pathStr}${portStr}`;
        });
        const labelText = Array.from(new Set(formattedPaths)).join(" • ");

        sysEdges.push({
          id: `e-sys-${ing.id}-${svcId}`,
          source: ing.id,
          target: svcId,
          type: "bezier",
          animated: true,
          label: labelText,
          labelStyle: { fill: "#c4b5fd", fontSize: 9.5, fontWeight: 600, fontFamily: "monospace" },
          labelBgStyle: { fill: "#141417", stroke: "#8b5cf6", strokeWidth: 1, fillOpacity: 0.95 },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 6,
          sourceHandle: "right-source",
          targetHandle: "left-target",
          style: { stroke: "#8b5cf6", strokeWidth: 2 },
        });
      });
    }
  });

  // 2. Service -> Pod (Traffic routing based on label selectors)
  services.forEach((svc) => {
    const svcData = svc.data as K8sServiceData;
    const svcSelector = svcData.selector;
    if (svcSelector && Object.keys(svcSelector).length > 0) {
      pods.forEach((pod) => {
        const podData = pod.data as K8sPodData;
        const labels = podData.labels as Record<string, string>;
        if (labels) {
          const match = Object.keys(svcSelector).every(
            (key) => labels[key] === svcSelector[key as keyof typeof svcSelector]
          );
          if (match) {
            sysEdges.push({
              id: `e-sys-${svc.id}-${pod.id}`,
              source: svc.id,
              target: pod.id,
              type: "bezier",
              animated: true,
              sourceHandle: "right-source",
              targetHandle: "left-target",
              style: { stroke: "#0ea5e9", strokeWidth: 2 },
            });
          }
        }
      });
    }
  });

  // 3. Pod -> Service (Strict container env var matching for internal TCP calls)
  pods.forEach((pod) => {
    const podData = pod.data as K8sPodData;
    const containers: Array<{ env?: Array<{ name?: string; value?: string }> }> = (podData.containers as any) || [];
    const envVars: Array<{ name?: string; value?: string }> = containers.flatMap((c) => c.env || []);

    services.forEach((svc) => {
      const svcData = svc.data as K8sServiceData;
      const svcName = svcData.name;
      if (!svcName) return;

      // Skip if pod is already targeted by this service
      const isTargetedByService = sysEdges.some((e) => e.source === svc.id && e.target === pod.id);
      if (isTargetedByService) return;

      // Strict match: exact service name or FQDN prefix (e.g. redis-headless-service.testing-todo.svc)
      const hasExactEnvMatch = envVars.some((envItem: { name?: string; value?: string }) => {
        if (!envItem.value) return false;
        const val = envItem.value.trim();
        return (
          val === svcName ||
          val.startsWith(`${svcName}.`) ||
          val.startsWith(`http://${svcName}`) ||
          val.startsWith(`https://${svcName}`)
        );
      });

      const isBackendRedisMatch =
        (svcName.includes("redis") || svcName.includes("db")) &&
        ((podData.name && (podData.name.includes("backend") || podData.name.includes("api"))) ||
          (pod.id && (pod.id.includes("backend") || pod.id.includes("api"))));

      if (hasExactEnvMatch || isBackendRedisMatch) {
        sysEdges.push({
          id: `e-sys-dep-${pod.id}-${svc.id}`,
          source: pod.id,
          target: svc.id,
          type: "bezier",
          animated: true,
          label: "TCP/Internal",
          labelStyle: { fill: "#60a5fa", fontSize: 9, fontWeight: 500, fontFamily: "monospace" },
          labelBgStyle: { fill: "#09090b", stroke: "#3b82f6", strokeWidth: 1, fillOpacity: 0.8 },
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 4,
          sourceHandle: "right-source",
          targetHandle: "left-target",
          style: { stroke: "#3b82f6", strokeWidth: 1.5, strokeDasharray: "4,4" },
        });
      }
    });
  });

  return [...baseEdges, ...sysEdges];
};

export const syncSelectedNode = (nodes: Node[], currentSelected: SelectedTarget): SelectedTarget => {
  if (!currentSelected || !currentSelected.data) return null;
  const targetName = currentSelected.data.name;
  if (!targetName) return currentSelected;

  const matched = nodes.find(
    (n) => n.id === targetName || (n.data as { name?: string })?.name === targetName
  );
  if (matched && matched.data) {
    if (matched.type === "k8sPod") {
      return { type: "pod", data: matched.data as K8sPodData };
    } else if (matched.type === "k8sWorker") {
      return { type: "node", data: matched.data as K8sNodeData };
    } else if (matched.type === "k8sService") {
      return { type: "service", data: matched.data as K8sServiceData };
    }
  }
  return currentSelected;
};

export const aggregateNodesWithWorkloads = (
  nodes: Node[],
  expandedWorkloads: Record<string, boolean>,
  onToggleExpand: (name: string) => void
): Node[] => {
  const podNodes = nodes.filter((n) => n.type === "k8sPod");
  const nonPodNodes = nodes.filter((n) => n.type !== "k8sPod");

  const podsByPrefix = new Map<string, Node[]>();

  podNodes.forEach((pod) => {
    const podData = pod.data as K8sPodData;
    const name = podData?.name || pod.id;

    let prefix = name;
    if (name.startsWith("db-audit-cronjob")) {
      prefix = "db-audit-cronjob";
    } else if (name.startsWith("worker-pool")) {
      prefix = "worker-pool";
    } else if (name.startsWith("todo-backend")) {
      prefix = "todo-backend";
    } else if (name.startsWith("todo-frontend")) {
      prefix = "todo-frontend";
    } else if (name.includes("-")) {
      prefix = name
        .replace(/-(?:[a-f0-9]{8,10}|\d{8,10})-[a-z0-9]{4,6}$/i, "")
        .replace(/-[a-z0-9]{4,6}$/i, "");
    }

    const existing = podsByPrefix.get(prefix) || [];
    existing.push(pod);
    podsByPrefix.set(prefix, existing);
  });

  const processedPodNodes: Node[] = [];

  podsByPrefix.forEach((groupPods, prefix) => {
    // High-replica pod aggregation threshold: >= 3 pods
    if (groupPods.length >= 3) {
      const isExpanded = Boolean(expandedWorkloads[prefix]);
      const readyCount = groupPods.filter(
        (p) => (p.data as K8sPodData)?.status === "Running"
      ).length;
      const firstPodData = (groupPods[0].data as K8sPodData) || {};
      const podDataList = groupPods.map((p) => p.data as K8sPodData);

      processedPodNodes.push({
        id: `workload-${prefix}`,
        type: "k8sWorkload",
        position: groupPods[0].position || { x: 50, y: 300 },
        data: {
          name: prefix,
          namespace: firstPodData.namespace || "testing-todo",
          replicas: groupPods.length,
          readyReplicas: readyCount,
          workloadType: prefix.includes("cronjob") || prefix.includes("audit") ? "JobGroup" : "WorkloadGroup",
          isAggregated: true,
          isExpanded,
          pods: podDataList,
          onToggleExpand,
        },
      });
    } else {
      processedPodNodes.push(...groupPods);
    }
  });

  return [...nonPodNodes, ...processedPodNodes];
};

export interface TopologyState {
  clusters: string[];
  activeCluster: string;
  rawNodes: Node[];
  nodes: Node[];
  edges: Edge[];
  services: K8sServiceData[];
  pods: K8sPodData[];
  ingresses: K8sIngressData[];
  selectedNode: SelectedTarget;
  tokens: ApiToken[];
  notifications: NotificationItem[];
  wsStatus: WsConnectionStatus;
  wsLatencyMs: number;

  // Selected Node Actions
  setSelectedNode: (target: SelectedTarget) => void;
  clearSelectedNode: () => void;

  // Granular Resource Actions (Nodes, Services, Pods)
  upsertNode: (node: Node) => void;
  removeTarget: (targetId: string) => void;
  removeNode: (nodeId: string) => void;
  upsertService: (serviceData: Partial<K8sServiceData> & { id?: string; name: string }) => void;
  removeService: (serviceId: string) => void;
  upsertPod: (podData: Partial<K8sPodData> & { id?: string; name: string }) => void;
  removePod: (podId: string) => void;

  // Resource Array Setters
  setServices: (services: K8sServiceData[] | ((prev: K8sServiceData[]) => K8sServiceData[])) => void;
  setPods: (pods: K8sPodData[] | ((prev: K8sPodData[]) => K8sPodData[])) => void;

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
  applyDelta: (delta: WsTopologyMessage) => void;

  // Token Actions
  generateToken: (name?: string) => void;
  revokeToken: (id: string) => void;

  expandedWorkloads: Record<string, boolean>;
  toggleWorkloadExpanded: (workloadName: string) => void;

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
      rawNodes: defaultInitialNodes,
      nodes: defaultInitialNodes,
      edges: defaultInitialEdges,
      services: extractServices(defaultInitialNodes),
      pods: extractPods(defaultInitialNodes),
      ingresses: [],
      selectedNode: null,
      tokens: defaultInitialTokens,
      notifications: defaultInitialNotifications,
      wsStatus: "DISCONNECTED",
      wsLatencyMs: 12,
      expandedWorkloads: {},

      toggleWorkloadExpanded: (workloadName: string) => {
        const current = get().expandedWorkloads[workloadName];
        const updated = {
          ...get().expandedWorkloads,
          [workloadName]: !current,
        };
        set({ expandedWorkloads: updated });
        get().applyDagreLayout("LR");
      },

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

      addCluster: (clusterName) => {
        const trimmed = clusterName.trim();
        if (!trimmed) return;

        const currentClusters = get().clusters;
        const updatedClusters = currentClusters.includes(trimmed)
          ? currentClusters
          : [...currentClusters, trimmed];

        const timestamp = Date.now();
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
          notifications: [newNotif, ...get().notifications],
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

      removeTarget: (targetId: string) => {
        if (!targetId) return;
        const currentRaw = get().rawNodes || [];
        const currentNodes = get().nodes || [];

        const matchesTarget = (n: Node) => {
          if (n.id === targetId) return true;
          const d = n.data as Record<string, unknown> | undefined;
          if (!d) return false;
          const name = String(d.name || d.podName || d.serviceName || d.nodeName || "");
          return (
            name === targetId ||
            `svc-${name}` === targetId ||
            `pod-${name}` === targetId ||
            `node-${name}` === targetId ||
            `workload-${name}` === targetId
          );
        };

        const remainingRaw = currentRaw.filter((n) => !matchesTarget(n));
        const remainingNodes = currentNodes.filter((n) => !matchesTarget(n));

        const remainingRawIds = new Set(remainingRaw.map((n) => n.id));
        const remainingEdges = get().edges.filter(
          (e) => remainingRawIds.has(e.source) && remainingRawIds.has(e.target)
        );

        const selected = get().selectedNode;
        const isSelected =
          selected &&
          (selected.data?.name === targetId ||
            (selected as unknown as Node).id === targetId);

        set({
          rawNodes: remainingRaw,
          nodes: remainingNodes,
          services: extractServices(remainingRaw),
          pods: extractPods(remainingRaw),
          ingresses: get().ingresses.filter((i) => i.name !== targetId),
          edges: remainingEdges,
          selectedNode: isSelected ? null : syncSelectedNode(remainingRaw, selected),
        });

        get().applyDagreLayout("LR");
      },

      removeNode: (nodeId) => {
        get().removeTarget(nodeId);
      },

      upsertService: (serviceData) => {
        const name = serviceData.name;
        const current = get().rawNodes && get().rawNodes.length > 0 ? get().rawNodes : get().nodes;
        const idx = current.findIndex(
          (n) => n.id === serviceData.id || (n.data as K8sServiceData)?.name === name
        );

        let updated: Node[];
        if (idx >= 0) {
          const existing = current[idx];
          updated = [...current];
          updated[idx] = {
            ...existing,
            data: { ...(existing.data as K8sServiceData), ...serviceData },
          };
        } else {
          const timestamp = Date.now();
          const newServiceNode: Node = {
            id: serviceData.id || `service-${name}-${timestamp}`,
            type: "k8sService",
            position: { x: 300, y: 150 },
            data: {
              name,
              type: serviceData.type || "ClusterIP",
              port: serviceData.port || ":8080",
            } as K8sServiceData,
          };
          updated = [...current, newServiceNode];
        }
        set({
          rawNodes: updated,
          services: extractServices(updated),
          pods: extractPods(updated),
          selectedNode: syncSelectedNode(updated, get().selectedNode),
        });
        get().applyDagreLayout("LR");
      },

      removeService: (serviceId) => {
        get().removeTarget(serviceId);
      },

      upsertPod: (podData) => {
        const name = podData.name;
        const current = get().rawNodes && get().rawNodes.length > 0 ? get().rawNodes : get().nodes;
        const idx = current.findIndex(
          (n) => n.id === podData.id || (n.data as K8sPodData)?.name === name
        );

        let updated: Node[];
        if (idx >= 0) {
          const existing = current[idx];
          updated = [...current];
          updated[idx] = {
            ...existing,
            data: { ...(existing.data as K8sPodData), ...podData },
          };
        } else {
          const timestamp = Date.now();
          const newPodNode: Node = {
            id: podData.id || `pod-${name}-${timestamp}`,
            type: "k8sPod",
            position: { x: 550, y: 150 },
            data: {
              name,
              namespace: podData.namespace || "default",
              nodeName: podData.nodeName || "minikube-worker-1",
              status: podData.status || "Running",
              restarts: podData.restarts ?? 0,
              ip: podData.ip || "10.244.0.10",
              cpuUsage: podData.cpuUsage || "30 mcores",
              memoryUsage: podData.memoryUsage || "120 MiB",
            } as K8sPodData,
          };
          updated = [...current, newPodNode];
        }
        set({
          rawNodes: updated,
          services: extractServices(updated),
          pods: extractPods(updated),
          selectedNode: syncSelectedNode(updated, get().selectedNode),
        });
        get().applyDagreLayout("LR");
      },

      removePod: (podId) => {
        get().removeTarget(podId);
      },

      setServices: (servicesInput) => {
        const currentServices = get().services;
        const nextServices = typeof servicesInput === "function" ? servicesInput(currentServices) : servicesInput;
        const currentNodes = get().nodes;
        const nonServiceNodes = currentNodes.filter((n) => n.type !== "k8sService");
        const serviceNodes: Node[] = nextServices.map((svcData, index) => ({
          id: `svc-${svcData.name}`,
          type: "k8sService",
          position: { x: 50 + (index % 4) * 250, y: 180 },
          data: svcData,
        }));
        const updatedNodes = [...nonServiceNodes, ...serviceNodes];
        set({
          nodes: updatedNodes,
          services: nextServices,
          pods: extractPods(updatedNodes),
        });
      },

      setPods: (podsInput) => {
        const currentPods = get().pods;
        const nextPods = typeof podsInput === "function" ? podsInput(currentPods) : podsInput;
        const currentNodes = get().nodes;
        const nonPodNodes = currentNodes.filter((n) => n.type !== "k8sPod");
        const podNodes: Node[] = nextPods.map((podData, index) => ({
          id: `pod-${podData.name}`,
          type: "k8sPod",
          position: { x: 580, y: 60 + (index % 5) * 110 },
          data: podData,
        }));
        const updatedNodes = [...nonPodNodes, ...podNodes];
        set({
          nodes: updatedNodes,
          services: extractServices(updatedNodes),
          pods: nextPods,
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

        const nextNodes = [...get().nodes, newNode];
        set({
          nodes: nextNodes,
          services: extractServices(nextNodes),
          pods: extractPods(nextNodes),
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
          services: extractServices(remainingNodes),
          pods: extractPods(remainingNodes),
          edges: remainingEdges,
        });
      },

      deleteNode: (nodeId) => {
        get().removeTarget(nodeId);
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

        const updatedNodes = applyNodeChanges(changes, get().nodes);
        set({ nodes: updatedNodes });
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
        const { rawNodes, nodes, edges, expandedWorkloads, toggleWorkloadExpanded } = get();
        const baseNodes = rawNodes && rawNodes.length > 0 ? rawNodes : nodes;
        if (baseNodes.length === 0) return;

        const aggregatedNodes = aggregateNodesWithWorkloads(
          baseNodes,
          expandedWorkloads,
          toggleWorkloadExpanded
        );

        const dynamicEdges = generateDynamicEdges(aggregatedNodes, edges);

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          aggregatedNodes,
          dynamicEdges,
          direction
        );
        set({ nodes: layoutedNodes, edges: layoutedEdges });
      },

      setWsStatus: (status, latencyMs) => {
        const currentMs = get().wsLatencyMs;
        const validMs = latencyMs && latencyMs > 0 && latencyMs < 200
          ? latencyMs
          : (currentMs > 0 && currentMs < 200 ? currentMs : 8);

        set({
          wsStatus: status,
          wsLatencyMs: status === "CONNECTED" ? validMs : 0,
        });
      },

      processWsMessage: (msg) => {
        const eventType = String(msg.event || msg.type || "");
        const payloadData = (msg.data !== undefined ? msg.data : msg.payload) as Record<string, unknown> | undefined;
        if (!eventType) return;
        
        if (eventType === "EVENT_BATCH_COMPLETE") {
          get().applyDagreLayout("LR");
          return;
        }

        if (!payloadData) return;

        const currentRaw = get().rawNodes && get().rawNodes.length > 0 ? get().rawNodes : get().nodes;

        if (eventType === "EVENT_TOPOLOGY_SNAPSHOT" && Array.isArray(payloadData.nodes)) {
          const snapshotNodes = payloadData.nodes as Node[];
          set({
            rawNodes: snapshotNodes,
            services: extractServices(snapshotNodes),
            pods: extractPods(snapshotNodes),
          });
          get().applyDagreLayout("LR");
        } else if (eventType === "EVENT_SNAPSHOT_SYNC" && payloadData) {
          const snapshotPods = Array.isArray(payloadData.pods) ? (payloadData.pods as Record<string, unknown>[]) : [];
          const activePodNames = new Set(snapshotPods.map((p) => String(p.name || p.id || "")).filter(Boolean));

          // Purge stale pod nodes that no longer exist in live cluster snapshot
          const syncedRawNodes = currentRaw.filter((n) => {
            if (n.type === "k8sPod") {
              const podName = (n.data as K8sPodData)?.name || n.id;
              return activePodNames.has(podName);
            }
            return true;
          });

          set({
            rawNodes: syncedRawNodes,
            services: extractServices(syncedRawNodes),
            pods: extractPods(syncedRawNodes),
          });
          get().applyDagreLayout("LR");
        } else if (
          eventType === "EVENT_POD_STATUS_CHANGED" ||
          eventType === "EVENT_POD_ADDED" ||
          eventType === "EVENT_POD_MODIFIED" ||
          eventType === "ADD_POD" ||
          eventType === "UPDATE_POD"
        ) {
          const podObj = (payloadData.pod || payloadData) as Record<string, unknown>;
          const namespace = podObj.namespace ? String(podObj.namespace) : "default";
          // Ignore noisy system namespaces to clean up the graph
          if (["kube-system", "ingress-nginx", "local-path-storage", "argocd"].includes(namespace)) return;

          const podName = String(podObj.name || podObj.id || "");
          if (!podName) return;

          const existingIdx = currentRaw.findIndex(
            (n) => n.id === podName || (n.data as K8sPodData)?.name === podName
          );

          const rawStatus = String(podObj.phase || podObj.status || "Running");
          const validStatus: K8sPodData["status"] = (
            ["Running", "CrashLoopBackOff", "Pending", "Terminated", "Failed", "Unknown"].includes(rawStatus)
              ? rawStatus
              : "Running"
          ) as K8sPodData["status"];

          let updatedRawNodes: Node[];
          if (existingIdx >= 0) {
            const existingNode = currentRaw[existingIdx];
            const existingData = existingNode.data as K8sPodData;
            const updatedPodData: K8sPodData = {
              ...existingData,
              status: validStatus,
              restarts: podObj.restartCount !== undefined ? Number(podObj.restartCount) : (podObj.restarts !== undefined ? Number(podObj.restarts) : existingData.restarts),
              nodeName: podObj.nodeName ? String(podObj.nodeName) : existingData.nodeName,
              cpuUsage: podObj.cpuUsagePct !== undefined ? `${podObj.cpuUsagePct}%` : (podObj.cpuUsage ? String(podObj.cpuUsage) : existingData.cpuUsage),
              memoryUsage: podObj.memoryUsageMb !== undefined ? `${podObj.memoryUsageMb} MiB` : (podObj.memoryUsage ? String(podObj.memoryUsage) : existingData.memoryUsage),
              ownerName: podObj.ownerName ? String(podObj.ownerName) : existingData.ownerName,
              ownerKind: podObj.ownerKind ? String(podObj.ownerKind) : existingData.ownerKind,
              ownerUid: podObj.ownerUid ? String(podObj.ownerUid) : existingData.ownerUid,
            };

            updatedRawNodes = [...currentRaw];
            updatedRawNodes[existingIdx] = {
              ...existingNode,
              data: updatedPodData,
            };
          } else if (podObj.type === "k8sPod" && podObj.id) {
            const podNode = podObj as unknown as Node;
            const existing = currentRaw.filter((n) => n.id !== podNode.id);
            updatedRawNodes = [...existing, podNode];
          } else {
            const timestamp = Date.now();
            const newPodId = podObj.id ? String(podObj.id) : `pod-${podName}-${timestamp}`;
            const podNodeName = podObj.nodeName ? String(podObj.nodeName) : "minikube-worker-1";
            const newPodNode: Node = {
              id: newPodId,
              type: "k8sPod",
              position: { x: 550, y: 100 + (currentRaw.length % 5) * 80 },
              data: {
                name: podName,
                namespace: podObj.namespace ? String(podObj.namespace) : "default",
                nodeName: podNodeName,
                status: validStatus,
                restarts: podObj.restartCount ? Number(podObj.restartCount) : 0,
                ip: podObj.ip ? String(podObj.ip) : "10.244.0.22",
                cpuUsage: podObj.cpuUsagePct ? `${podObj.cpuUsagePct}%` : "32 mcores",
                memoryUsage: podObj.memoryUsageMb ? `${podObj.memoryUsageMb} MiB` : "120 MiB",
                labels: podObj.labels || {},
                ownerName: podObj.ownerName ? String(podObj.ownerName) : "",
                ownerKind: podObj.ownerKind ? String(podObj.ownerKind) : "",
                ownerUid: podObj.ownerUid ? String(podObj.ownerUid) : "",
              } as K8sPodData,
            };
            updatedRawNodes = [...currentRaw, newPodNode];
          }
          set({
            rawNodes: updatedRawNodes,
            services: extractServices(updatedRawNodes),
            pods: extractPods(updatedRawNodes),
            selectedNode: syncSelectedNode(updatedRawNodes, get().selectedNode),
          });
          get().applyDagreLayout("LR");
        } else if (
          eventType === "EVENT_NODE_MUTATED" ||
          eventType === "EVENT_NODE_ADDED" ||
          eventType === "EVENT_NODE_MODIFIED" ||
          eventType === "ADD_NODE" ||
          eventType === "UPDATE_NODE"
        ) {
          return; // [Option A] Hide physical worker nodes from visual traffic flow
        } else if (
          eventType === "EVENT_SERVICE_MUTATED" ||
          eventType === "EVENT_SERVICE_ADDED" ||
          eventType === "EVENT_SERVICE_MODIFIED" ||
          eventType === "ADD_SERVICE" ||
          eventType === "UPDATE_SERVICE"
        ) {
          const svcObj = (payloadData.service || payloadData) as Record<string, unknown>;
          const namespace = svcObj.namespace ? String(svcObj.namespace) : "default";
          if (["kube-system", "ingress-nginx", "local-path-storage", "argocd", "default"].includes(namespace)) return;

          const svcName = String(svcObj.name || svcObj.id || "");
          if (!svcName) return;

          const existingIdx = currentRaw.findIndex(
            (n) => n.id === svcName || (n.data as K8sServiceData)?.name === svcName
          );

          let updatedRawNodes: Node[];
          if (existingIdx >= 0) {
            const existingNode = currentRaw[existingIdx];
            updatedRawNodes = [...currentRaw];
            updatedRawNodes[existingIdx] = {
              ...existingNode,
              data: { ...(existingNode.data as K8sServiceData), ...svcObj, selector: svcObj.selector || (existingNode.data as K8sServiceData).selector || {} },
            };
          } else if (svcObj.type === "k8sService" && svcObj.id) {
            const svcNode = svcObj as unknown as Node;
            const existing = currentRaw.filter((n) => n.id !== svcNode.id);
            updatedRawNodes = [...existing, svcNode];
          } else {
            const timestamp = Date.now();
            const newServiceNode: Node = {
              id: svcObj.id ? String(svcObj.id) : `service-${svcName}-${timestamp}`,
              type: "k8sService",
              position: { x: 300, y: 150 + (currentRaw.length % 5) * 60 },
              data: {
                name: svcName,
                type: svcObj.type ? String(svcObj.type) : "ClusterIP",
                port: svcObj.port ? String(svcObj.port) : (
                  Array.isArray(svcObj.targetPorts) && svcObj.targetPorts.length > 0
                    ? `:${svcObj.targetPorts[0]}`
                    : (Array.isArray(svcObj.ports) && svcObj.ports.length > 0
                        ? `:${(svcObj.ports[0] as Record<string, unknown>).port || svcObj.ports[0]}`
                        : ":8080")
                ),
                selector: svcObj.selector || {},
              } as K8sServiceData,
            };
            updatedRawNodes = [...currentRaw, newServiceNode];
          }
          set({
            rawNodes: updatedRawNodes,
            services: extractServices(updatedRawNodes),
            pods: extractPods(updatedRawNodes),
            selectedNode: syncSelectedNode(updatedRawNodes, get().selectedNode),
          });
          get().applyDagreLayout("LR");
        } else if (
          eventType === "EVENT_DEPLOYMENT_MUTATED" ||
          eventType === "EVENT_DEPLOYMENT_ADDED" ||
          eventType === "EVENT_REPLICA_SET_MUTATED" ||
          eventType === "EVENT_REPLICA_SET_ADDED" ||
          eventType === "EVENT_STATEFUL_SET_MUTATED" ||
          eventType === "EVENT_STATEFUL_SET_ADDED"
        ) {
          return; // [Option A] Hide abstract controllers from visual traffic flow
        } else if (
          eventType === "EVENT_INGRESS_MUTATED" ||
          eventType === "EVENT_INGRESS_ADDED"
        ) {
          const ingObj = (payloadData.ingress || payloadData) as Record<string, unknown>;
          const namespace = ingObj.namespace ? String(ingObj.namespace) : "default";
          if (["kube-system", "ingress-nginx", "local-path-storage", "argocd", "default"].includes(namespace)) return;

          const ingName = String(ingObj.name || ingObj.id || "");
          if (!ingName) return;

          const existingIdx = currentRaw.findIndex(
            (n) => (n.id === ingName || (n.data as K8sIngressData)?.name === ingName) && n.type === "k8sIngress"
          );

          let updatedRawNodes: Node[];
          if (existingIdx >= 0) {
            const existingNode = currentRaw[existingIdx];
            updatedRawNodes = [...currentRaw];
            updatedRawNodes[existingIdx] = {
              ...existingNode,
              data: {
                ...(existingNode.data as K8sIngressData),
                ...ingObj,
              },
            };
          } else {
            const newIngressNode: Node = {
              id: ingName,
              type: "k8sIngress",
              position: { x: 50, y: 150 + (currentRaw.length % 5) * 60 },
              data: {
                name: ingName,
                namespace: namespace,
                rules: (ingObj.rules as IngressRuleData[]) || [],
              } as K8sIngressData,
            };
            updatedRawNodes = [...currentRaw, newIngressNode];
          }
          set({
            rawNodes: updatedRawNodes,
            services: extractServices(updatedRawNodes),
            pods: extractPods(updatedRawNodes),
            selectedNode: syncSelectedNode(updatedRawNodes, get().selectedNode),
          });
          get().applyDagreLayout("LR");
        } else if (
          eventType === "EVENT_POD_DELETED" ||
          eventType === "DELETE_POD"
        ) {
          const targetId = String(payloadData.podId || payloadData.name || payloadData.id || "");
          if (targetId) {
            get().removeTarget(targetId);
          }
        } else if (
          eventType === "EVENT_NODE_DELETED" ||
          eventType === "DELETE_NODE"
        ) {
          const targetId = String(payloadData.nodeId || payloadData.name || payloadData.id || "");
          if (targetId) {
            get().removeTarget(targetId);
          }
        } else if (
          eventType === "EVENT_SERVICE_DELETED" ||
          eventType === "DELETE_SERVICE"
        ) {
          const targetId = String(payloadData.serviceId || payloadData.name || payloadData.id || "");
          if (targetId) {
            get().removeTarget(targetId);
          }
        } else if (
          eventType === "EVENT_INGRESS_DELETED" ||
          eventType === "DELETE_INGRESS"
        ) {
          const targetId = String(payloadData.ingressId || payloadData.name || payloadData.id || "");
          if (targetId) {
            get().removeTarget(targetId);
          }
        } else if (eventType === "EVENT_ALERT_TRIGGERED") {
          const rawSeverity = String(payloadData.severity || "WARNING");
          const validSeverity: NotificationItem["severity"] = (
            ["CRITICAL", "WARNING", "INFO"].includes(rawSeverity) ? rawSeverity : "WARNING"
          ) as NotificationItem["severity"];

          const alertNotif: NotificationItem = {
            id: `alert-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            title: String(payloadData.title || "Cluster Alert Triggered"),
            message: String(payloadData.message || "An unexpected telemetry event was recorded."),
            time: "Just now",
            severity: validSeverity,
            read: false,
            cluster: String(payloadData.cluster || msg.clusterId || get().activeCluster),
          };
          set({ notifications: [alertNotif, ...get().notifications] });
        } else if (eventType === "EVENT_CHAOS_INJECTED" || eventType === "CHAOS_INJECTED") {
          const targetName = String(payloadData.target || payloadData.targetName || payloadData.name || "");
          const faultType = String(payloadData.faultType || payloadData.action || "Chaos SIGKILL Fault");

          if (targetName) {
            const currentRaw = get().rawNodes && get().rawNodes.length > 0 ? get().rawNodes : get().nodes;
            const updatedRaw = currentRaw.map((n) => {
              if (n.id === targetName || (n.data as K8sPodData)?.name === targetName) {
                return {
                  ...n,
                  data: {
                    ...n.data,
                    status: "CrashLoopBackOff" as const,
                    restarts: ((n.data as K8sPodData).restarts || 0) + 1,
                  },
                };
              }
              return n;
            });

            const alertNotif: NotificationItem = {
              id: `alert-chaos-${Date.now()}`,
              title: `Chaos Injected: ${faultType}`,
              message: `Target ${targetName} was injected with ${faultType} simulation.`,
              time: "Just now",
              severity: "CRITICAL",
              read: false,
              cluster: String(payloadData.cluster || msg.clusterId || get().activeCluster),
            };

            set({
              rawNodes: updatedRaw,
              notifications: [alertNotif, ...get().notifications],
            });
            get().applyDagreLayout("LR");
          }
        }
      },

      applyDelta: (delta) => {
        get().processWsMessage(delta);
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
          rawNodes: defaultInitialNodes,
          nodes: defaultInitialNodes,
          edges: defaultInitialEdges,
          services: extractServices(defaultInitialNodes),
          pods: extractPods(defaultInitialNodes),
          ingresses: [],
          selectedNode: null,
          tokens: defaultInitialTokens,
          notifications: defaultInitialNotifications,
        });
      },
    }),
    {
      name: "envscale-topology-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeCluster: state.activeCluster,
        clusters: state.clusters,
      }),
    }
  )
);
