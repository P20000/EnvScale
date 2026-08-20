import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { incidents } from "../db/schema.js";

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