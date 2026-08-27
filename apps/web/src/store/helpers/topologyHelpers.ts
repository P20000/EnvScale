import type { Node, Edge } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sNodeData } from "../../components/canvas/K8sNode";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData, IngressRuleData } from "../../components/canvas/K8sIngress";
import type { SelectedTarget } from "../../components/drawer/InspectorDrawer";
import { calculateRolloutInfo, type K8sDeploymentData, type K8sReplicaSetData } from "./rolloutHelpers";

export const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", "ingress-nginx"]);

export const extractServices = (nodes: Node[]): K8sServiceData[] =>
  nodes
    .filter((n) => n.type === "k8sService" && Boolean(n.data))
    .map((n) => n.data as K8sServiceData);

export const extractPods = (nodes: Node[]): K8sPodData[] =>
  nodes
    .filter((n) => n.type === "k8sPod" && Boolean(n.data))
    .map((n) => n.data as K8sPodData);

export const getPodPrefix = (name: string) => {
  let prefix = name;
  if (name.startsWith("db-audit-cronjob")) return "db-audit-cronjob";
  if (name.startsWith("worker-pool")) return "worker-pool";
  if (name.startsWith("todo-backend-canary")) return "todo-backend-canary";
  if (name.startsWith("todo-backend")) return "todo-backend";
  if (name.startsWith("todo-frontend")) return "todo-frontend";
  if (name.startsWith("redis")) return "redis-db";
  if (name.includes("-")) {
    prefix = name
      .replace(/-(?:[a-f0-9]{8,10}|\d{8,10})-[a-z0-9]{4,6}$/i, "")
      .replace(/-\d+$/i, "")
      .replace(/-[a-z0-9]{4,6}$/i, "");
  }
  return prefix;
};

export type EdgeHealthStatus = "healthy" | "broken" | "degraded" | "idle";

export const isPodReady = (pod: unknown): boolean => {
  if (!pod) return false;
  const p = pod as Record<string, unknown>;
  const podData = (p.data as Record<string, unknown>) || p;
  const raw = (podData.rawResource as Record<string, unknown>) || podData;
  const statusObj = (podData.status || raw.status || {}) as Record<string, unknown>;

  const phaseStr = String(
    (typeof statusObj === "string" ? statusObj : statusObj.phase) ||
    podData.phase ||
    podData.status ||
    ""
  ).toLowerCase();

  const isReadyCondition = Array.isArray(statusObj.conditions)
    ? statusObj.conditions.some(
        (c: Record<string, unknown>) => c.type === "Ready" && c.status === "True"
      )
    : false;

  const isReadyFlag = podData.ready === true || raw.ready === true;

  return (
    phaseStr === "running" ||
    phaseStr === "ready" ||
    phaseStr === "succeeded" ||
    phaseStr === "completed" ||
    Boolean(isReadyCondition) ||
    isReadyFlag
  );
};

export const extractPodList = (groupPodsInput: unknown): unknown[] => {
  if (!groupPodsInput) return [];
  if (Array.isArray(groupPodsInput)) return groupPodsInput;

  const nodeObj = groupPodsInput as Record<string, unknown>;
  const nodeData = (nodeObj.data as Record<string, unknown>) || nodeObj;

  if (Array.isArray(nodeData.pods)) return nodeData.pods;
  if (Array.isArray(nodeData.children)) return nodeData.children;

  return [groupPodsInput];
};

export const calculateEdgeHealth = (
  _svc: unknown,
  groupPodsInput: unknown
): { healthStatus: EdgeHealthStatus; strokeColor: string } => {
  const podList = extractPodList(groupPodsInput);

  if (!podList || podList.length === 0) {
    return { healthStatus: "broken", strokeColor: "#ef4444" };
  }

  let healthyCount = 0;
  let failingCount = 0;

  podList.forEach((p) => {
    const isReady = isPodReady(p);
    const pData = ((p as Record<string, unknown>).data as Record<string, unknown>) || (p as Record<string, unknown>);
    const status = String(pData.phase || pData.status || "").toLowerCase();

    if (isReady) {
      healthyCount++;
    } else if (
      status.includes("crash") ||
      status.includes("fail") ||
      status.includes("error") ||
      status.includes("oom")
    ) {
      failingCount++;
    }
  });

  if (failingCount > 0 && healthyCount > 0) {
    return { healthStatus: "degraded", strokeColor: "#f59e0b" };
  }
  if (failingCount > 0 && healthyCount === 0) {
    return { healthStatus: "broken", strokeColor: "#ef4444" };
  }
  if (healthyCount > 0) {
    return { healthStatus: "healthy", strokeColor: "#10b981" };
  }

  return { healthStatus: "idle", strokeColor: "#475569" };
};

export const getEdgeHealth = calculateEdgeHealth;

export const generateDynamicEdges = (nodes: Node[], currentEdges: Edge[] = []): Edge[] => {
  const baseEdges = currentEdges.filter((e) => !e.id.startsWith("e-sys-"));
  const sysEdges: Edge[] = [];

  const pods = nodes.filter((n) => n.type === "k8sPod");
  const services = nodes.filter((n) => n.type === "k8sService");
  const ingresses = nodes.filter((n) => n.type === "k8sIngress");

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

        const targetSvc = services.find((s) => s.id === svcId);
        let strokeColor = "#8b5cf6"; // Purple Ingress default
        if (targetSvc) {
          const svcSelector = (targetSvc.data as K8sServiceData).selector;
          if (svcSelector && Object.keys(svcSelector).length > 0) {
            const matched = pods.filter((p) => {
              const pData = p.data as K8sPodData;
              const labels = pData.labels as Record<string, string>;
              return labels && Object.keys(svcSelector).every((k) => labels[k] === svcSelector[k]);
            });
            const health = calculateEdgeHealth(targetSvc, matched);
            if (health.healthStatus === "broken") strokeColor = "#ef4444";
            else if (health.healthStatus === "degraded") strokeColor = "#f59e0b";
          }
        }

        sysEdges.push({
          id: `e-sys-${ing.id}-${svcId}`,
          source: ing.id,
          target: svcId,
          type: "k8sEdge",
          animated: false,
          label: labelText,
          data: { label: labelText, strokeColor },
          style: { stroke: strokeColor, strokeWidth: 2, strokeDasharray: "none" },
        });
      });
    }
  });

  services.forEach((svc) => {
    const svcData = svc.data as K8sServiceData;
    const svcSelector = svcData.selector;
    if (svcSelector && Object.keys(svcSelector).length > 0) {
      const targetedGroups = new Set<string>();
      const matchingPods = pods.filter((pod) => {
        const podData = pod.data as K8sPodData;
        const labels = podData.labels as Record<string, string>;
        if (labels) {
          const match = Object.keys(svcSelector).every(
            (key) => labels[key] === svcSelector[key as keyof typeof svcSelector]
          );
          if (match && pod.parentId) {
            targetedGroups.add(pod.parentId);
          }
          return match;
        }
        return false;
      });

      targetedGroups.forEach((groupId) => {
        const groupPods = matchingPods.filter((p) => p.parentId === groupId);
        const podsToCheck = groupPods.length > 0 ? groupPods : matchingPods;
        const { healthStatus, strokeColor } = calculateEdgeHealth(svc, podsToCheck);

        sysEdges.push({
          id: `e-sys-${svc.id}-${groupId}`,
          source: svc.id,
          target: groupId,
          type: "k8sEdge",
          animated: false,
          data: { healthStatus, strokeColor },
          style: { stroke: strokeColor, strokeWidth: 2, strokeDasharray: "none" },
        });
      });
    }
  });

  return [...baseEdges, ...sysEdges];
};

export const syncSelectedNode = (nodes: Node[], currentSelected: SelectedTarget): SelectedTarget => {
  if (!currentSelected || !currentSelected.data) return null;
  const targetName = currentSelected.data.name;
  const targetNs = (currentSelected.data as { namespace?: string }).namespace;
  if (!targetName) return currentSelected;

  const matched = nodes.find(
    (n) =>
      n.id === targetName ||
      (n.data as { name?: string })?.name === targetName ||
      ((n.data as { name?: string; namespace?: string })?.name === targetName &&
        (n.data as { name?: string; namespace?: string })?.namespace === targetNs)
  );
  if (matched && matched.data) {
    if (matched.type === "k8sPod") {
      return { type: "pod", data: matched.data as K8sPodData };
    } else if (matched.type === "k8sWorker") {
      return { type: "node", data: matched.data as K8sNodeData };
    } else if (matched.type === "k8sService") {
      return { type: "service", data: matched.data as K8sServiceData };
    } else if (matched.type === "k8sIngress") {
      return { type: "ingress", data: matched.data as K8sIngressData };
    }
  }
  return currentSelected;
};

export const extractAvailableNamespaces = (nodes: Node[]): string[] => {
  const nsSet = new Set<string>();
  nodes.forEach((n) => {
    const d = n.data as Record<string, unknown> | undefined;
    if (d?.namespace && typeof d.namespace === "string") {
      nsSet.add(d.namespace);
    }
  });
  const list = Array.from(nsSet);
  return list.length > 0 ? list.sort() : ["testing-todo", "default"];
};

export const aggregateNodesWithWorkloads = (
  nodes: Node[],
  showCompletedPods: boolean = false,
  showSystemNamespaces: boolean = false,
  selectedNamespaces: string[] = [],
  deployments: K8sDeploymentData[] = [],
  replicaSets: K8sReplicaSetData[] = []
): Node[] => {
  const appNodes = nodes.filter((n) => {
    const d = n.data as Record<string, unknown> | undefined;
    const ns = String(d?.namespace || "default");

    if (Array.isArray(selectedNamespaces)) {
      if (selectedNamespaces.length === 0) {
        return false;
      }
      if (!selectedNamespaces.includes(ns)) {
        return false;
      }
    } else if (!showSystemNamespaces) {
      if (SYSTEM_NAMESPACES.has(ns)) {
        return false;
      }
      const name = String(d?.name || n.id || "");
      if (
        name.startsWith("node-minikube") ||
        name === "minikube" ||
        name.includes("coredns") ||
        name.includes("metrics-server") ||
        name.includes("ingress-nginx-controller")
      ) {
        return false;
      }
    }
    return true;
  });

  const podNodes = appNodes.filter((n) => {
    if (n.type !== "k8sPod") return false;
    const podData = n.data as K8sPodData;
    const rawRes = (podData?.rawResource as Record<string, unknown>) || {};
    const meta = (rawRes.metadata as Record<string, unknown>) || {};
    const podPhase = String(podData?.phase || podData?.status || "").toLowerCase();

    if (meta.deletionTimestamp || podPhase === "terminating" || podPhase === "deleted") {
      return false;
    }

    if (
      podPhase === "completed" ||
      podPhase === "terminated" ||
      podPhase === "succeeded" ||
      podPhase === "failed"
    ) {
      const isBatchJob = podData?.ownerKind === "Job" || podData?.name?.includes("cronjob");
      if (!showCompletedPods || !isBatchJob) {
        return false;
      }
    }

    return true;
  });
  const nonPodNodes = appNodes.filter((n) => n.type !== "k8sPod");

  const podsByPrefix = new Map<string, Node[]>();

  podNodes.forEach((pod) => {
    const podData = pod.data as K8sPodData;
    const name = podData?.name || pod.id;
    const prefix = getPodPrefix(name);

    const existing = podsByPrefix.get(prefix) || [];
    existing.push(pod);
    podsByPrefix.set(prefix, existing);
  });

  const processedNodes: Node[] = [];

  podsByPrefix.forEach((groupPods, prefix) => {
    const groupId = `group-${prefix}`;

    const sortedGroupPods = [...groupPods].sort((a, b) => {
      const pA = String((a.data as K8sPodData)?.phase || (a.data as K8sPodData)?.status || "").toLowerCase();
      const pB = String((b.data as K8sPodData)?.phase || (b.data as K8sPodData)?.status || "").toLowerCase();

      const isAActive = pA === "running" || pA === "ready" || pA.includes("crash") || pA.includes("oom");
      const isBActive = pB === "running" || pB === "ready" || pB.includes("crash") || pB.includes("oom");

      if (isAActive && !isBActive) return -1;
      if (!isAActive && isBActive) return 1;

      const timeA = new Date(String((a.data as K8sPodData)?.createdAt || 0)).getTime();
      const timeB = new Date(String((b.data as K8sPodData)?.createdAt || 0)).getTime();
      return timeB - timeA;
    });

    const activeRunningPods = sortedGroupPods.filter((p) => {
      const ph = String((p.data as K8sPodData)?.phase || (p.data as K8sPodData)?.status || "").toLowerCase();
      return ph === "running" || ph === "ready" || ph.includes("crash") || ph.includes("oom");
    });

    const activeCap = Math.max(2, activeRunningPods.length);
    const finalGroupPods = sortedGroupPods.slice(0, activeCap);

    const firstPodData = (groupPods[0]?.data as K8sPodData) || {};
    const ns = firstPodData.namespace || "testing-todo";
    const rolloutInfo = calculateRolloutInfo(prefix, ns, deployments, replicaSets);

    processedNodes.push({
      id: groupId,
      type: "k8sGroup",
      position: { x: 0, y: 0 },
      data: { name: prefix, namespace: ns, rolloutInfo },
    });

    finalGroupPods.forEach((pod, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = 16 + col * (208 + 10);
      const y = 40 + row * (32 + 10);

      processedNodes.push({
        ...pod,
        parentId: groupId,
        extent: "parent",
        position: { x, y },
      });
    });
  });

  return [...nonPodNodes, ...processedNodes];
};

export const sanitizeManifestSnapshot = (node: Node): Record<string, unknown> => {
  const d = (node.data as Record<string, unknown>) || {};
  const rawRes = (d.rawResource as Record<string, unknown>) || {};

  const manifest: Record<string, unknown> = {
    apiVersion: rawRes.apiVersion || "v1",
    kind: rawRes.kind || (node.type === "k8sService" ? "Service" : node.type === "k8sPod" ? "Pod" : "Deployment"),
    metadata: {
      name: d.name || node.id,
      namespace: d.namespace || "testing-todo",
      labels: (rawRes.metadata as Record<string, unknown>)?.labels || {},
    },
    spec: rawRes.spec || d,
  };

  const meta = manifest.metadata as Record<string, unknown>;
  delete meta.resourceVersion;
  delete meta.uid;
  delete meta.creationTimestamp;
  delete meta.generation;
  delete meta.managedFields;
  delete manifest.status;

  return manifest;
};
