import { and, desc, eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { alertPolicies, incidents, workspaceMembers, workspaces } from "../db/schema.js";

const publicIncidentFields = {
  id: incidents.id,
  workspaceId: incidents.workspaceId,
  clusterId: incidents.clusterId,
  alertPolicyId: incidents.alertPolicyId,
  title: incidents.title,
  description: incidents.description,
  severity: incidents.severity,
  status: incidents.status,
  value: incidents.value,
  acknowledgedBy: incidents.acknowledgedBy,
  acknowledgedAt: incidents.acknowledgedAt,
  resolvedBy: incidents.resolvedBy,
  resolvedAt: incidents.resolvedAt,
  rootCause: incidents.rootCause,
  resolution: incidents.resolution,
  relatedEvents: incidents.relatedEvents,
  createdAt: incidents.createdAt,
  updatedAt: incidents.updatedAt,
};

export const listIncidents = (workspaceId: string) =>
  db
    .select(publicIncidentFields)
    .from(incidents)
    .where(eq(incidents.workspaceId, workspaceId))
    .orderBy(desc(incidents.createdAt));

export const listIncidentsForUser = (userId: string) =>
  db
    .select(publicIncidentFields)
    .from(incidents)
    .innerJoin(workspaces, eq(incidents.workspaceId, workspaces.id))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, incidents.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .where(or(eq(workspaces.ownerId, userId), eq(workspaceMembers.userId, userId)))
    .orderBy(desc(incidents.createdAt));

export const getIncident = async (incidentId: string) => {
  const result = await db
    .select(publicIncidentFields)
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  return result[0];
};

export const resolveIncident = async (
  incidentId: string,
  userId: string,
  resolution?: string | null
) => {
  const [incident] = await db
    .update(incidents)
    .set({
      status: "resolved",
      resolvedBy: userId,
      resolvedAt: new Date(),
      ...(resolution === undefined ? {} : { resolution }),
      updatedAt: new Date(),
    })
    .where(eq(incidents.id, incidentId))
    .returning(publicIncidentFields);
  return incident;
};

export const triggerIncidentFromAlert = async (data: {
  ruleId: string;
  clusterId: string;
  targetKind: string;
  targetName: string;
  namespace?: string;
  measured?: string;
  threshold?: string;
  severity?: string;
  message?: string;
  timestamp?: string;
}) => {
  if (!data.ruleId) {
    return null;
  }

  // 1. Fetch matching alert policy
  const policy = await db
    .select()
    .from(alertPolicies)
    .where(eq(alertPolicies.id, data.ruleId))
    .limit(1);

  if (!policy[0]) {
    console.warn(`[IncidentService] Warning: Alert rule ${data.ruleId} not found in database`);
    return null;
  }

  const pol = policy[0];

  // 2. Check for active/open incident for this policy and cluster
  const existingOpen = await db
    .select(publicIncidentFields)
    .from(incidents)
    .where(
      and(
        eq(incidents.alertPolicyId, pol.id),
        eq(incidents.clusterId, data.clusterId),
        eq(incidents.status, "open")
      )
    )
    .limit(1);

  if (existingOpen.length > 0) {
    const existing = existingOpen[0];
    const related = (Array.isArray(existing.relatedEvents) ? existing.relatedEvents : []) as unknown[];
    related.push({ ...data, recordedAt: new Date().toISOString() });

    const [updated] = await db
      .update(incidents)
      .set({
        relatedEvents: related.slice(-20),
        updatedAt: new Date(),
      })
      .where(eq(incidents.id, existing.id))
      .returning(publicIncidentFields);
    return updated;
  }

  // 3. Extract clean numeric value for PostgreSQL decimal column if numeric
  const cleanValue = data.measured ? data.measured.replace(/[^0-9.-]+/g, "") : null;
  const numValue = cleanValue && !isNaN(parseFloat(cleanValue)) ? cleanValue : null;

  const [created] = await db
    .insert(incidents)
    .values({
      workspaceId: pol.workspaceId,
      clusterId: pol.clusterId || data.clusterId,
      alertPolicyId: pol.id,
      title: data.message || `Alert: ${pol.name} triggered on ${data.targetKind} ${data.targetName}`,
      description: data.message || `Metric ${pol.metric} threshold violation`,
      severity: (data.severity?.toLowerCase() || pol.severity || "warning"),
      status: "open",
      value: numValue,
      relatedEvents: [{ ...data, recordedAt: new Date().toISOString() }],
    })
    .returning(publicIncidentFields);

  return created;
};