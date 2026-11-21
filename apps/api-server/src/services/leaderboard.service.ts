import { and, desc, eq, gte, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { clusters, healthSnapshots, incidents, workspaceMembers, workspaces } from "../db/schema.js";

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const average = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const longestZeroIncidentStreak = (createdDates: Date[], days: number) => {
  const incidentDays = new Set(createdDates.map((date) => date.toISOString().slice(0, 10)));
  let longest = 0;
  let current = 0;
  const cursor = new Date();

  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() - offset);
    if (!incidentDays.has(day.toISOString().slice(0, 10))) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
};

const badgesFor = (averageUptime: number | null, zeroIncidentStreak: number, resolvedCount: number) => {
  const badges: string[] = [];
  if (averageUptime !== null && averageUptime >= 99.9) badges.push("99.9% Uptime Club");
  if (zeroIncidentStreak >= 7) badges.push("Zero Crash Streak");
  if (resolvedCount >= 10) badges.push("Chaos Master");
  return badges;
};

export const getLeaderboard = async (userId: string) => {
  const memberships = await db
    .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .leftJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .where(or(eq(workspaces.ownerId, userId), eq(workspaceMembers.userId, userId)));
  if (!memberships.length) return [];

  const workspaceIds = memberships.map((workspace) => workspace.id);
  const since = daysAgo(7);
  const snapshotRows = await db
    .select({
      workspaceId: clusters.workspaceId,
      healthScore: healthSnapshots.healthScore,
      uptime: healthSnapshots.uptime,
    })
    .from(healthSnapshots)
    .innerJoin(clusters, eq(healthSnapshots.clusterId, clusters.id))
    .where(and(gte(healthSnapshots.timestamp, since), or(...workspaceIds.map((id) => eq(clusters.workspaceId, id)))));
  const incidentRows = await db
    .select({ workspaceId: incidents.workspaceId, createdAt: incidents.createdAt, status: incidents.status })
    .from(incidents)
    .where(and(gte(incidents.createdAt, since), or(...workspaceIds.map((id) => eq(incidents.workspaceId, id)))));

  return memberships
    .map((workspace) => {
      const workspaceSnapshots = snapshotRows.filter((row) => row.workspaceId === workspace.id);
      const workspaceIncidents = incidentRows.filter((row) => row.workspaceId === workspace.id);
      const averageHealthScore = average(
        workspaceSnapshots.map((row) => Number(row.healthScore))
      );
      const averageUptime = average(
        workspaceSnapshots
          .map((row) => (row.uptime === null ? null : Number(row.uptime)))
          .filter((value): value is number => value !== null)
      );
      const zeroIncidentStreak = longestZeroIncidentStreak(
        workspaceIncidents.map((incident) => incident.createdAt),
        7
      );
      const resolvedCount = workspaceIncidents.filter(
        (incident) => incident.status?.toLowerCase() === "resolved"
      ).length;
      return {
        workspaceId: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        averageHealthScore,
        zeroIncidentStreakDays: zeroIncidentStreak,
        averageUptime,
        resolvedIncidentCount: resolvedCount,
        badges: badgesFor(averageUptime, zeroIncidentStreak, resolvedCount),
      };
    })
    .sort((left, right) =>
      (right.averageHealthScore ?? -1) - (left.averageHealthScore ?? -1) ||
      right.zeroIncidentStreakDays - left.zeroIncidentStreakDays
    )
    .map((workspace, index) => ({ rank: index + 1, ...workspace }));
};

export const getWorkspaceHealthHistory = async (workspaceId: string, days = 7) => {
  const rows = await db
    .select({
      clusterId: healthSnapshots.clusterId,
      healthScore: healthSnapshots.healthScore,
      timestamp: healthSnapshots.timestamp,
      uptime: healthSnapshots.uptime,
      details: healthSnapshots.details,
    })
    .from(healthSnapshots)
    .innerJoin(clusters, eq(healthSnapshots.clusterId, clusters.id))
    .where(and(eq(clusters.workspaceId, workspaceId), gte(healthSnapshots.timestamp, daysAgo(days))))
    .orderBy(desc(healthSnapshots.timestamp));
  return rows;
};