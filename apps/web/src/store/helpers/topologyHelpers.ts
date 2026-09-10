import type { Node } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sNodeData } from "../../components/canvas/K8sNode";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData } from "../../components/canvas/K8sIngress";
import type { K8sDaemonSetData, K8sCronJobData, K8sJobData } from "../types/topologyTypes";
import type { SelectedTarget } from "../../components/drawer/InspectorDrawer";
import { calculateRolloutInfo, type K8sDeploymentData, type K8sReplicaSetData } from "./rolloutHelpers";
export {
  type EdgeHealthStatus,
  isPodReady,
  extractPodList,
  calculateEdgeHealth,
  getEdgeHealth,
  generateDynamicEdges,
} from "./edgeHelpers";

export const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease", "ingress-nginx"]);

export const extractServices = (nodes: Node[]): K8sServiceData[] =>
  nodes
    .filter((n) => n.type === "k8sService" && Boolean(n.data))
    .map((n) => n.data as K8sServiceData);

export const extractPods = (nodes: Node[]): K8sPodData[] =>
  nodes
    .filter((n) => n.type === "k8sPod" && Boolean(n.data))
    .map((n) => n.data as K8sPodData);

export const getPodPrefix = (name: string, podData?: K8sPodData) => {
  if (podData?.ownerName) return podData.ownerName.replace(/-(?:[a-f0-9]{8,10}|\d{8,10})$/i, "");
  if (!name.includes("-")) return name;
  return name
    .replace(/-(?:[a-f0-9]{8,10}|\d{8,10})-[a-z0-9]{4,6}$/i, "")
    .replace(/-\d+$/i, "")
    .replace(/-[a-z0-9]{4,6}$/i, "");
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
    } else if (matched.type === "k8sJob") {
      return { type: "job", data: matched.data as K8sJobData };
    } else if (matched.type === "k8sDaemonSet") {
      return { type: "daemonset", data: matched.data as K8sDaemonSetData };
    } else if (matched.type === "k8sCronJob") {
      return { type: "cronjob", data: matched.data as K8sCronJobData };
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
  return list.length > 0 ? list.sort() : [];
};

export const aggregateNodesWithWorkloads = (
  nodes: Node[],
  showCompletedPods: boolean = false,
  showSystemNamespaces: boolean = false,
  selectedNamespaces: string[] | string = [],
  deployments: K8sDeploymentData[] = [],
  replicaSets: K8sReplicaSetData[] = [],
  daemonSets: K8sDaemonSetData[] = [],
  cronJobs: K8sCronJobData[] = [],
  jobs: K8sJobData[] = [],
  showCompletedJobs: boolean = false
): Node[] => {
  const appNodes = nodes.filter((n) => {
    const d = n.data as Record<string, unknown> | undefined;
    const ns = String(d?.namespace || "default");

    let isExplicitlyRequested = false;
    if (typeof selectedNamespaces === "string" && selectedNamespaces !== "all") {
      if (ns !== selectedNamespaces) return false;
      isExplicitlyRequested = true;
    } else if (Array.isArray(selectedNamespaces) && selectedNamespaces.length > 0) {
      if (selectedNamespaces.includes("__NONE__")) return false;
      if (!selectedNamespaces.includes(ns)) return false;
      isExplicitlyRequested = true;
    }

    if (!showSystemNamespaces && !isExplicitlyRequested) {
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

  const daemonSetNames = new Set((daemonSets || []).map((ds) => ds.name));
  const cronJobNames = new Set((cronJobs || []).map((cj) => cj.name));

  const podNodes = appNodes.filter((n) => {
    if (n.type !== "k8sPod") return false;
    const podData = n.data as K8sPodData;

    if (
      podData?.ownerKind === "DaemonSet" ||
      (podData?.ownerName && daemonSetNames.has(podData.ownerName))
    ) {
      return false;
    }

    if (
      podData?.ownerKind === "Job" ||
      podData?.ownerKind === "CronJob" ||
      podData?.labels?.["job-name"] ||
      (podData?.ownerName && cronJobNames.has(podData.ownerName))
    ) {
      return false;
    }

    const podName = podData?.name || n.id;
    const prefix = getPodPrefix(podName, podData);
    if (daemonSetNames.has(prefix)) {
      return false;
    }

    const podPhase = String(podData?.phase || podData?.status || "").toLowerCase();

    if (podPhase === "deleted") {
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
  const nonPodNodes = appNodes
    .filter((n) => n.type !== "k8sPod")
    .map((n) => {
      if (n.type === "k8sWorker" && daemonSets && daemonSets.length > 0) {
        const workerData = n.data as K8sNodeData;
        const daemonAgents = daemonSets.map((ds) => ({
          name: ds.name,
          namespace: ds.namespace,
          ready: (ds.numberReady ?? 0) > 0,
        }));
        return {
          ...n,
          data: {
            ...workerData,
            daemonAgents,
          },
        };
      }
      return n;
    });

  const podsByPrefix = new Map<string, Node[]>();

  podNodes.forEach((pod) => {
    const podData = pod.data as K8sPodData;
    const name = podData?.name || pod.id;
    const prefix = getPodPrefix(name, podData);

    const existing = podsByPrefix.get(prefix) || [];
    existing.push(pod);
    podsByPrefix.set(prefix, existing);
  });

  const processedNodes: Node[] = [];

  podsByPrefix.forEach((groupPods, prefix) => {
    const groupId = `group-${prefix}`;

    const sortedGroupPods = [...groupPods].sort((a, b) => {
      const pAData = a.data as K8sPodData;
      const pBData = b.data as K8sPodData;
      const pA = String(pAData?.phase || pAData?.status || "").toLowerCase();
      const pB = String(pBData?.phase || pBData?.status || "").toLowerCase();
      const isATerminating = Boolean(pAData?.isTerminating || pA === "terminating");
      const isBTerminating = Boolean(pBData?.isTerminating || pB === "terminating");

      if (!isATerminating && isBTerminating) return -1;
      if (isATerminating && !isBTerminating) return 1;

      const isAActive = pA === "running" || pA === "ready" || pA.includes("crash") || pA.includes("oom");
      const isBActive = pB === "running" || pB === "ready" || pB.includes("crash") || pB.includes("oom");

      if (isAActive && !isBActive) return -1;
      if (!isAActive && isBActive) return 1;

      const timeA = new Date(String(pAData?.createdAt || 0)).getTime();
      const timeB = new Date(String(pBData?.createdAt || 0)).getTime();
      return timeB - timeA;
    });

    const activeRunningPods = sortedGroupPods.filter((p) => {
      const pData = p.data as K8sPodData;
      const ph = String(pData?.phase || pData?.status || "").toLowerCase();
      const isTerminating = Boolean(pData?.isTerminating || ph === "terminating");
      return !isTerminating && (ph === "running" || ph === "ready" || ph.includes("crash") || ph.includes("oom"));
    });

    const drainingPods = sortedGroupPods.filter((p) => {
      const pData = p.data as K8sPodData;
      const ph = String(pData?.phase || pData?.status || "").toLowerCase();
      return Boolean(pData?.isTerminating || ph === "terminating");
    });

    const activeCap = Math.max(2, activeRunningPods.length + drainingPods.length);
    const finalGroupPods = sortedGroupPods.slice(0, activeCap);

    const firstPodData = groupPods[0]?.data as K8sPodData | undefined;
    const ns = firstPodData?.namespace || "default";
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

  const dsNodes: Node[] = (daemonSets || [])
    .filter((ds) => {
      const ns = ds.namespace || "default";
      let isExplicitlyRequested = false;
      if (typeof selectedNamespaces === "string" && selectedNamespaces !== "all") {
        if (ns !== selectedNamespaces) return false;
        isExplicitlyRequested = true;
      } else if (Array.isArray(selectedNamespaces) && selectedNamespaces.length > 0) {
        if (selectedNamespaces.includes("__NONE__")) return false;
        if (!selectedNamespaces.includes(ns)) return false;
        isExplicitlyRequested = true;
      }
      if (!showSystemNamespaces && !isExplicitlyRequested && SYSTEM_NAMESPACES.has(ns)) return false;
      return true;
    })
    .map((ds) => ({
      id: `daemonset-${ds.name}`,
      type: "k8sDaemonSet",
      position: { x: 0, y: 0 },
      data: ds,
    }));

  const cjNodes: Node[] = (cronJobs || [])
    .filter((cj) => {
      const ns = cj.namespace || "default";
      let isExplicitlyRequested = false;
      if (typeof selectedNamespaces === "string" && selectedNamespaces !== "all") {
        if (ns !== selectedNamespaces) return false;
        isExplicitlyRequested = true;
      } else if (Array.isArray(selectedNamespaces) && selectedNamespaces.length > 0) {
        if (selectedNamespaces.includes("__NONE__")) return false;
        if (!selectedNamespaces.includes(ns)) return false;
        isExplicitlyRequested = true;
      }
      if (!showSystemNamespaces && !isExplicitlyRequested && SYSTEM_NAMESPACES.has(ns)) return false;
      return true;
    })
    .map((cj) => ({
      id: `cronjob-${cj.name}`,
      type: "k8sCronJob",
      position: { x: 0, y: 0 },
      data: cj,
    }));

  const jobNodes: Node[] = [];
  const filteredJobs = (jobs || []).filter((j) => {
    const ns = j.namespace || "default";
    let isExplicitlyRequested = false;
    if (typeof selectedNamespaces === "string" && selectedNamespaces !== "all") {
      if (ns !== selectedNamespaces) return false;
      isExplicitlyRequested = true;
    } else if (Array.isArray(selectedNamespaces) && selectedNamespaces.length > 0) {
      if (selectedNamespaces.includes("__NONE__")) return false;
      if (!selectedNamespaces.includes(ns)) return false;
      isExplicitlyRequested = true;
    }
    if (!showSystemNamespaces && !isExplicitlyRequested && SYSTEM_NAMESPACES.has(ns)) return false;
    return true;
  });

  const activeOrFailedJobs: K8sJobData[] = [];
  const completedJobs: K8sJobData[] = [];

  filteredJobs.forEach((j) => {
    const isCompleted = (j.succeeded ?? 0) >= (j.completions ?? 1) || (j.active === 0 && (j.failed ?? 0) === 0);
    if (isCompleted) {
      completedJobs.push(j);
    } else {
      activeOrFailedJobs.push(j);
    }
  });

  // Active and Failed jobs are always rendered as individual cards on the side-rail
  activeOrFailedJobs.forEach((j) => {
    jobNodes.push({
      id: `job-${j.name}`,
      type: "k8sJob",
      position: { x: 0, y: 0 },
      data: j,
    });
  });

  // Completed jobs: if showCompletedJobs is true, render individually; otherwise collapse into a single summary card
  if (showCompletedJobs) {
    completedJobs.forEach((j) => {
      jobNodes.push({
        id: `job-${j.name}`,
        type: "k8sJob",
        position: { x: 0, y: 0 },
        data: j,
      });
    });
  } else if (completedJobs.length > 0) {
    jobNodes.push({
      id: "completed-jobs-summary",
      type: "k8sCompletedJobs",
      position: { x: 0, y: 0 },
      data: { count: completedJobs.length },
    });
  }

  return [...nonPodNodes, ...dsNodes, ...cjNodes, ...jobNodes, ...processedNodes];
};

export const sanitizeManifestSnapshot = (node: Node): Record<string, unknown> => {
  const d = (node.data as Record<string, unknown>) || {};
  const rawRes = (d.rawResource as Record<string, unknown>) || {};

  const manifest: Record<string, unknown> = {
    apiVersion: rawRes.apiVersion || "v1",
    kind: rawRes.kind || (node.type === "k8sService" ? "Service" : node.type === "k8sPod" ? "Pod" : "Deployment"),
    metadata: {
      name: d.name || node.id,
      namespace: d.namespace || "default",
      labels: (rawRes.metadata as Record<string, unknown>)?.labels || {},
    },
    spec: rawRes.spec || d,
  };

  const meta = manifest.metadata as Record<string, unknown>;
  ["resourceVersion", "uid", "creationTimestamp", "generation", "managedFields"].forEach((k) => delete meta[k]);
  delete manifest.status;
  return manifest;
};
