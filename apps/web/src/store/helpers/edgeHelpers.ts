import type { Node, Edge } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData, IngressRuleData } from "../../components/canvas/K8sIngress";
import { generateStorageEdges } from "./storageHelpers";

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
): { healthStatus: EdgeHealthStatus; strokeColor: string; isDraining?: boolean } => {
  const podList = extractPodList(groupPodsInput);
  if (!podList || podList.length === 0) return { healthStatus: "broken", strokeColor: "#ef4444" };

  let healthyCount = 0;
  let failingCount = 0;
  let drainingCount = 0;

  podList.forEach((p) => {
    const pData = ((p as Record<string, unknown>).data as Record<string, unknown>) || (p as Record<string, unknown>);
    const status = String(pData.phase || pData.status || "").toLowerCase();
    const isTerminating = Boolean(pData.isTerminating || status === "terminating");

    if (isTerminating) {
      drainingCount++;
      return;
    }

    if (isPodReady(p)) {
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

  if (healthyCount === 0 && failingCount === 0 && drainingCount > 0) {
    return { healthStatus: "idle", strokeColor: "#52525b", isDraining: true };
  }
  if (failingCount > 0 && healthyCount > 0) return { healthStatus: "degraded", strokeColor: "#f59e0b" };
  if (failingCount > 0 && healthyCount === 0) return { healthStatus: "broken", strokeColor: "#ef4444" };
  if (healthyCount > 0) return { healthStatus: "healthy", strokeColor: "#10b981" };

  return { healthStatus: "idle", strokeColor: "#475569" };
};

export const getEdgeHealth = calculateEdgeHealth;

export const generateDynamicEdges = (nodes: Node[], currentEdges: Edge[] = []): Edge[] => {
  const baseEdges = currentEdges.filter(
    (e) => !e.id.startsWith("e-sys-") && !e.id.startsWith("e-storage-") && !e.id.startsWith("e-dep-")
  );
  const sysEdges: Edge[] = [];

  const pods = nodes.filter((n) => n.type === "k8sPod");
  const services = nodes.filter((n) => n.type === "k8sService");
  const ingresses = nodes.filter((n) => n.type === "k8sIngress");

  const groups = nodes.filter((n) => n.type === "k8sGroup");
  const allGroupPods = groups.flatMap((g) => ((g.data as Record<string, unknown>)?.pods as K8sPodData[]) || []);

  ingresses.forEach((ing) => {
    const rules = (ing.data as K8sIngressData).rules as IngressRuleData[];
    if (rules && rules.length > 0) {
      const rulesBySvc = new Map<string, IngressRuleData[]>();
      rules.forEach((rule) => {
        if (rule.serviceName) {
          const svc = services.find((s) => s.id === rule.serviceName || (s.data as K8sServiceData).name === rule.serviceName);
          if (svc) {
            const existing = rulesBySvc.get(svc.id) || [];
            existing.push(rule);
            rulesBySvc.set(svc.id, existing);
          }
        }
      });

      rulesBySvc.forEach((svcRules, svcId) => {
        const formattedPaths = svcRules.map((r) => `${r.path || "/"}${r.servicePort ? `:${r.servicePort}` : ""}`);
        const labelText = Array.from(new Set(formattedPaths)).join(" • ");
        const targetSvc = services.find((s) => s.id === svcId);
        let strokeColor = "#8b5cf6";
        if (targetSvc) {
          const rawSelector = (targetSvc.data as K8sServiceData)?.selector;
          const selectorEntries = Object.entries(rawSelector || {}).filter(([k, v]) => Boolean(k) && typeof v === "string" && v.trim().length > 0);
          if (selectorEntries.length > 0) {
            const candidatePods = [...pods, ...allGroupPods];
            const matched = candidatePods.filter((p) => {
              const labels = ((p as Record<string, unknown>).labels || ((p as Record<string, unknown>).data as Record<string, unknown>)?.labels || {}) as Record<string, string>;
              return selectorEntries.every(([k, v]) => labels[k] === v);
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

  const genericLabels = new Set(["app.kubernetes.io/part-of", "app.kubernetes.io/managed-by", "heritage", "chart"]);

  services.forEach((svc) => {
    const svcData = svc.data as K8sServiceData;
    const rawSelector = svcData.selector || ((svcData.rawResource as Record<string, unknown>)?.spec as Record<string, unknown>)?.selector;

    const selectorEntries = Object.entries(rawSelector || {}).filter(
      ([key, val]) => key && !genericLabels.has(key) && typeof val === "string" && val.trim().length > 0
    );

    const svcNs = String(svcData.namespace || "default");
    if (selectorEntries.length === 0) return;

    groups.forEach((group) => {
      const groupData = group.data as Record<string, unknown> | undefined;
      const groupNs = String(groupData?.namespace || "default");
      // Enforce namespace match: services in namespace A must not cross into namespace B
      if (svcNs !== groupNs) return;

      const groupPods = (groupData?.pods as K8sPodData[]) || [];
      if (groupPods.length === 0) return;

      const isMatch = groupPods.some((pod) => {
        const podObj = (pod as Record<string, unknown>) || {};
        const innerData = (podObj.data as Record<string, unknown>) || podObj;
        const podLabels = (innerData.labels || podObj.labels || {}) as Record<string, string>;
        if (!podLabels || Object.keys(podLabels).length === 0) return false;
        return selectorEntries.every(([k, v]) => podLabels[k] === v);
      });

      if (isMatch) {
        const { healthStatus, strokeColor, isDraining } = calculateEdgeHealth(svc, groupPods);
        sysEdges.push({
          id: `e-sys-${svc.id}-${group.id}`,
          source: svc.id,
          target: group.id,
          type: "k8sEdge",
          animated: false,
          data: { healthStatus, strokeColor, isDraining },
          style: { stroke: strokeColor, strokeWidth: 2, strokeDasharray: isDraining ? "4 4" : "none" },
        });
      }
    });

    const matchingStandalone = pods.filter((pod) => {
      const podData = pod.data as K8sPodData;
      const podNs = String(podData?.namespace || "default");
      if (svcNs !== podNs || pod.parentId) return false;
      const labels = (podData?.labels || {}) as Record<string, string>;
      return selectorEntries.every(([key, val]) => labels[key] === val);
    });

    matchingStandalone.forEach((pod) => {
      const { healthStatus, strokeColor } = calculateEdgeHealth(svc, [pod]);
      sysEdges.push({
        id: `e-sys-${svc.id}-${pod.id}`,
        source: svc.id,
        target: pod.id,
        type: "k8sEdge",
        animated: false,
        data: { healthStatus, strokeColor },
        style: { stroke: strokeColor, strokeWidth: 2 },
      });
    });
  });

  // Cross-workload peer dependencies (e.g. backend -> redis database)
  const depEdges: Edge[] = [];
  groups.forEach((srcGrp) => {
    const srcData = srcGrp.data as Record<string, unknown> | undefined;
    const srcName = String(srcData?.name || "").toLowerCase();
    const srcNs = String(srcData?.namespace || "default");
    const srcPods = (srcData?.pods as K8sPodData[]) || [];

    groups.forEach((targetGrp) => {
      if (srcGrp.id === targetGrp.id) return;
      const targetData = targetGrp.data as Record<string, unknown> | undefined;
      const targetNs = String(targetData?.namespace || "default");
      if (srcNs !== targetNs) return;

      const targetName = String(targetData?.name || "").toLowerCase();
      const isTargetDb = targetName.includes("redis") || targetName.includes("db") || targetName.includes("database") || targetData?.workloadType === "StatefulSet";

      let hasEnvRef = false;
      let refLabel = "";

      srcPods.forEach((pod) => {
        const podAny = pod as Record<string, unknown>;
        const envList = (podAny.env || podAny.containers || []) as Array<Record<string, unknown>>;
        if (Array.isArray(envList)) {
          envList.forEach((item) => {
            const val = String(item.value || item.val || "");
            const name = String(item.name || item.key || "");
            if (val.includes(targetName) || (isTargetDb && (name.includes("REDIS") || name.includes("DB")))) {
              hasEnvRef = true;
              refLabel = `${name || "SERVICE_HOST"} :6379`;
            }
          });
        }
      });

      const isBackendApi = srcName.includes("backend") || srcName.includes("api");
      if ((hasEnvRef || (isBackendApi && isTargetDb)) && isTargetDb) {
        const edgeLabel = refLabel || "tcp://6379 • REDIS_HOST";
        depEdges.push({
          id: `e-dep-${srcGrp.id}-${targetGrp.id}`,
          source: srcGrp.id,
          target: targetGrp.id,
          targetHandle: "bottom-target",
          type: "k8sEdge",
          animated: true,
          label: edgeLabel,
          data: {
            label: edgeLabel,
            strokeColor: "#38bdf8",
            healthStatus: "healthy",
            isCrossWorkload: true,
          },
          style: {
            stroke: "#38bdf8",
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
          },
        });
      }
    });
  });

  const storageEdges = generateStorageEdges(nodes);
  const allEdges = [...baseEdges, ...sysEdges, ...storageEdges, ...depEdges];
  const seenIds = new Set<string>();
  return allEdges.filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });
};
