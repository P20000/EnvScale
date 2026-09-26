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
