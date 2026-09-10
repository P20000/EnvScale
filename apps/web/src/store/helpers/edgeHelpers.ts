import type { Node, Edge } from "@xyflow/react";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type { K8sServiceData } from "../../components/canvas/K8sService";
import type { K8sIngressData, IngressRuleData } from "../../components/canvas/K8sIngress";

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
          const svcSelector = (targetSvc.data as K8sServiceData).selector;
          if (svcSelector && Object.keys(svcSelector).length > 0) {
            const matched = pods.filter((p) => {
              const labels = (p.data as K8sPodData).labels as Record<string, string>;
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
          const match = Object.keys(svcSelector).every((key) => labels[key] === svcSelector[key as keyof typeof svcSelector]);
          if (match && pod.parentId) targetedGroups.add(pod.parentId);
          return match;
        }
        return false;
      });

      targetedGroups.forEach((groupId) => {
        const groupPods = matchingPods.filter((p) => p.parentId === groupId);
        const podsToCheck = groupPods.length > 0 ? groupPods : matchingPods;
        const { healthStatus, strokeColor, isDraining } = calculateEdgeHealth(svc, podsToCheck);

        sysEdges.push({
          id: `e-sys-${svc.id}-${groupId}`,
          source: svc.id,
          target: groupId,
          type: "k8sEdge",
          animated: false,
          data: { healthStatus, strokeColor, isDraining },
          style: { stroke: strokeColor, strokeWidth: 2, strokeDasharray: isDraining ? "4 4" : "none" },
        });
      });
    }
  });

  return [...baseEdges, ...sysEdges];
};
