import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { clusters, healthSnapshots, incidents } from "../db/schema.js";

const severityPenalties = {
  critical: 25,
  error: 15,
  warning: 8,
  info: 3,
} as const;

export type IncidentHealthInput = {
  severity: string | null;
  status: string | null;
};

export const calculateHealthScore = (clusterIncidents: IncidentHealthInput[]) => {
  const activeIncidents = clusterIncidents.filter(
    (incident) => incident.status?.toLowerCase() !== "resolved"
  );
  const penalties = activeIncidents.reduce((total, incident) => {
    const severity = incident.severity?.toLowerCase() as keyof typeof severityPenalties;
    return total + (severityPenalties[severity] ?? severityPenalties.warning);
  }, 0);

  return {
    score: Math.max(0, 100 - penalties),
    activeIncidentCount: activeIncidents.length,
    penalty: penalties,
    severityCounts: activeIncidents.reduce<Record<string, number>>((counts, incident) => {
      const severity = incident.severity?.toLowerCase() ?? "warning";
      counts[severity] = (counts[severity] ?? 0) + 1;
      return counts;
    }, {}),
  };
};

export const snapshotClusterHealth = async () => {
  const clusterList = await db
    .select({ id: clusters.id })
    .from(clusters);
  const incidentList = await db
    .select({ clusterId: incidents.clusterId, severity: incidents.severity, status: incidents.status })
    .from(incidents);

  const snapshots: Array<{ id: string; clusterId: string }> = [];
  for (const cluster of clusterList) {
    const result = calculateHealthScore(
      incidentList.filter((incident) => incident.clusterId === cluster.id)
    );

    await db.transaction(async (transaction) => {
      await transaction
        .update(clusters)
        .set({ healthScore: result.score.toFixed(2), updatedAt: new Date() })
        .where(eq(clusters.id, cluster.id));
      const [snapshot] = await transaction
        .insert(healthSnapshots)
        .values({
          clusterId: cluster.id,
          healthScore: result.score.toFixed(2),
          details: {
            activeIncidentCount: result.activeIncidentCount,
            penalty: result.penalty,
            severityCounts: result.severityCounts,
          },
        })
        .returning({ id: healthSnapshots.id, clusterId: healthSnapshots.clusterId });
      snapshots.push(snapshot);
    });
  }

  return snapshots;
};