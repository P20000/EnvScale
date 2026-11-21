import {
  pgTable,
  text,
  varchar,
  timestamp,
  decimal,
  uuid,
  jsonb,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";
import { clusters } from "./clusters";
import { alertPolicies } from "./alerts";

// ============================================================================
// INCIDENTS TABLE
// ============================================================================

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    clusterId: uuid("cluster_id").notNull(),
    alertPolicyId: uuid("alert_policy_id").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    severity: varchar("severity", { length: 50 }).notNull(),
    status: varchar("status", { length: 50 }).default("open"),
    value: decimal("value", {
      precision: 10,
      scale: 2,
    }),
    acknowledgedBy: uuid("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    relatedEvents: jsonb("related_events"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index("incidents_workspace_id_idx").on(
      table.workspaceId
    ),
    workspaceStatusIdx: index("incidents_workspace_status_idx").on(
      table.workspaceId,
      table.status
    ),
    clusterIdx: index("incidents_cluster_id_idx").on(table.clusterId),
    statusIdx: index("incidents_status_idx").on(table.status),
    severityIdx: index("incidents_severity_idx").on(table.severity),
    createdAtIdx: index("incidents_created_at_idx").on(table.createdAt),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "incidents_workspace_id_fk",
    }).onDelete("cascade"),
    clusterFk: foreignKey({
      columns: [table.clusterId],
      foreignColumns: [clusters.id],
      name: "incidents_cluster_id_fk",
    }).onDelete("cascade"),
    alertPolicyFk: foreignKey({
      columns: [table.alertPolicyId],
      foreignColumns: [alertPolicies.id],
      name: "incidents_alert_policy_id_fk",
    }).onDelete("cascade"),
    acknowledgedByFk: foreignKey({
      columns: [table.acknowledgedBy],
      foreignColumns: [users.id],
      name: "incidents_acknowledged_by_fk",
    }).onDelete("set null"),
    resolvedByFk: foreignKey({
      columns: [table.resolvedBy],
      foreignColumns: [users.id],
      name: "incidents_resolved_by_fk",
    }).onDelete("set null"),
  })
);
