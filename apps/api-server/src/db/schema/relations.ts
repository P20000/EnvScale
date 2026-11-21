import { relations } from "drizzle-orm";
import { users } from "./users";
import { workspaces, workspaceMembers } from "./workspaces";
import { clusters, healthSnapshots } from "./clusters";
import { alertPolicies } from "./alerts";
import { incidents } from "./incidents";

// ============================================================================
// RELATIONS
// ============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  workspaces: many(workspaces),
  workspaceMembers: many(workspaceMembers),
  alertPolicies: many(alertPolicies),
  acknowledgedIncidents: many(incidents, {
    relationName: "acknowledgedBy",
  }),
  resolvedIncidents: many(incidents, {
    relationName: "resolvedBy",
  }),
}));

export const workspacesRelations = relations(
  workspaces,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [workspaces.ownerId],
      references: [users.id],
    }),
    members: many(workspaceMembers),
    clusters: many(clusters),
    alertPolicies: many(alertPolicies),
    incidents: many(incidents),
  })
);

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
    }),
  })
);

export const clustersRelations = relations(
  clusters,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [clusters.workspaceId],
      references: [workspaces.id],
    }),
    alertPolicies: many(alertPolicies),
    incidents: many(incidents),
    healthSnapshots: many(healthSnapshots),
  })
);

export const alertPoliciesRelations = relations(
  alertPolicies,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [alertPolicies.workspaceId],
      references: [workspaces.id],
    }),
    cluster: one(clusters, {
      fields: [alertPolicies.clusterId],
      references: [clusters.id],
    }),
    createdByUser: one(users, {
      fields: [alertPolicies.createdBy],
      references: [users.id],
    }),
    incidents: many(incidents),
  })
);

export const incidentsRelations = relations(
  incidents,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [incidents.workspaceId],
      references: [workspaces.id],
    }),
    cluster: one(clusters, {
      fields: [incidents.clusterId],
      references: [clusters.id],
    }),
    alertPolicy: one(alertPolicies, {
      fields: [incidents.alertPolicyId],
      references: [alertPolicies.id],
    }),
    acknowledgedByUser: one(users, {
      fields: [incidents.acknowledgedBy],
      references: [users.id],
      relationName: "acknowledgedBy",
    }),
    resolvedByUser: one(users, {
      fields: [incidents.resolvedBy],
      references: [users.id],
      relationName: "resolvedBy",
    }),
  })
);

export const healthSnapshotsRelations = relations(
  healthSnapshots,
  ({ one }) => ({
    cluster: one(clusters, {
      fields: [healthSnapshots.clusterId],
      references: [clusters.id],
    }),
  })
);
