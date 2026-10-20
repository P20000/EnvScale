import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { alertPolicies, clusters } from "../db/schema.js";
import { createServiceToken } from "./auth.service.js";

const publicAlertPolicyFields = {
  id: alertPolicies.id,
  workspaceId: alertPolicies.workspaceId,
  clusterId: alertPolicies.clusterId,
  name: alertPolicies.name,
  description: alertPolicies.description,
  metric: alertPolicies.metric,
  threshold: alertPolicies.threshold,
  operator: alertPolicies.operator,
  duration: alertPolicies.duration,
  severity: alertPolicies.severity,
  isEnabled: alertPolicies.isEnabled,
  conditions: alertPolicies.conditions,
  notificationChannels: alertPolicies.notificationChannels,
  createdBy: alertPolicies.createdBy,
  createdAt: alertPolicies.createdAt,
  updatedAt: alertPolicies.updatedAt,
};

export type AlertPolicyValues = {
  clusterId: string;
  name: string;
  description?: string | null;
  metric: string;
  threshold: number;
  operator: string;
  duration: number;
  severity?: string;
  isEnabled?: boolean;
  conditions?: Record<string, unknown> | null;
  notificationChannels?: string[];
};

export class AlertPolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertPolicyValidationError";
  }
}

const ensureClusterBelongsToWorkspace = async (workspaceId: string, clusterId: string) => {
  const cluster = await db
    .select({ id: clusters.id })
    .from(clusters)
    .where(and(eq(clusters.id, clusterId), eq(clusters.workspaceId, workspaceId)))
    .limit(1);
  if (!cluster[0]) {
    throw new AlertPolicyValidationError("Cluster does not belong to this workspace");
  }
};

export const getAlertPolicy = async (policyId: string) => {
  const result = await db
    .select({ ...publicAlertPolicyFields })
    .from(alertPolicies)
    .where(eq(alertPolicies.id, policyId))
    .limit(1);
  return result[0];
};

export const listAlertPolicies = (workspaceId: string) =>
  db
    .select({ ...publicAlertPolicyFields })
    .from(alertPolicies)
    .where(eq(alertPolicies.workspaceId, workspaceId));

const syncRuleToStreamer = async (policy: {
  id: string;
  workspaceId: string;
  clusterId: string;
  name: string;
  metric: string;
  threshold: string;
  operator: string;
  duration: number;
  severity?: string | null;
  isEnabled?: boolean | null;
}) => {
  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";
  try {
    const serviceToken = createServiceToken();
    const payload = {
      ruleId: policy.id,
      workspaceId: policy.workspaceId,
      clusterId: policy.clusterId,
      metricType: policy.metric,
      conditionOperator: policy.operator,
      thresholdValue: parseFloat(policy.threshold) || 0,
      durationSeconds: policy.duration,
      severity: policy.severity ? policy.severity.toUpperCase() : "WARNING",
      enabled: policy.isEnabled !== false,
      name: policy.name,
    };

    await fetch(`${streamerUrl}/api/v1/evaluator/rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("[AlertPolicyService] Failed to sync rule to streamer:", err instanceof Error ? err.message : err);
  }
};

const deleteRuleFromStreamer = async (ruleId: string) => {
  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";
  try {
    const serviceToken = createServiceToken();
    await fetch(`${streamerUrl}/api/v1/evaluator/rules?ruleId=${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${serviceToken}`,
      },
    });
  } catch (err) {
    console.warn("[AlertPolicyService] Failed to delete rule from streamer:", err instanceof Error ? err.message : err);
  }
};

export const syncAllAlertPoliciesToStreamer = async (): Promise<void> => {
  const policies = await db
    .select()
    .from(alertPolicies)
    .where(eq(alertPolicies.isEnabled, true));

  if (policies.length === 0) return;

  const streamerUrl = process.env.K8S_STREAMER_URL || "http://localhost:8080";
  try {
    const serviceToken = createServiceToken();
    const rules = policies.map((policy) => ({
      ruleId: policy.id,
      workspaceId: policy.workspaceId,
      clusterId: policy.clusterId,
      metricType: policy.metric,
      conditionOperator: policy.operator,
      thresholdValue: parseFloat(policy.threshold) || 0,
      durationSeconds: policy.duration,
      severity: policy.severity ? policy.severity.toUpperCase() : "WARNING",
      enabled: policy.isEnabled !== false,
      name: policy.name,
    }));

    await fetch(`${streamerUrl}/api/v1/evaluator/rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(rules),
    });
    console.log(`[AlertPolicyService] Synced ${rules.length} active alert rules to streaming gateway.`);
  } catch (err) {
    console.warn("[AlertPolicyService] Failed to sync alert rules to streamer:", err instanceof Error ? err.message : err);
  }
};

export const createAlertPolicy = async (
  workspaceId: string,
  createdBy: string,
  values: AlertPolicyValues
) => {
  await ensureClusterBelongsToWorkspace(workspaceId, values.clusterId);
  const { threshold, ...rest } = values;
  const [policy] = await db
    .insert(alertPolicies)
    .values({ workspaceId, createdBy, ...rest, threshold: threshold.toString() })
    .returning(publicAlertPolicyFields);
  if (policy) void syncRuleToStreamer(policy);
  return policy;
};

export const updateAlertPolicy = async (
  policyId: string,
  values: Partial<Omit<AlertPolicyValues, "clusterId">> & { clusterId?: string }
) => {
  const current = await getAlertPolicy(policyId);
  if (!current) return undefined;

  if (values.clusterId) {
    await ensureClusterBelongsToWorkspace(current.workspaceId, values.clusterId);
  }

  const { threshold, ...rest } = values;
  const [policy] = await db
    .update(alertPolicies)
    .set({
      ...rest,
      ...(threshold === undefined ? {} : { threshold: threshold.toString() }),
      updatedAt: new Date(),
    })
    .where(eq(alertPolicies.id, policyId))
    .returning(publicAlertPolicyFields);
  if (policy) void syncRuleToStreamer(policy);
  return policy;
};

export const deleteAlertPolicy = async (policyId: string) => {
  await db.delete(alertPolicies).where(eq(alertPolicies.id, policyId));
  void deleteRuleFromStreamer(policyId);
};

export const toggleAlertPolicy = async (policyId: string, isEnabled: boolean) => {
  const [policy] = await db
    .update(alertPolicies)
    .set({ isEnabled, updatedAt: new Date() })
    .where(eq(alertPolicies.id, policyId))
    .returning(publicAlertPolicyFields);
  if (policy) void syncRuleToStreamer(policy);
  return policy;
};