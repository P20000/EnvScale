import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  decimal,
  uuid,
  jsonb,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";
import { clusters } from "./clusters";

// ============================================================================
// ALERT POLICIES TABLE
// ============================================================================

export const alertPolicies = pgTable(
  "alert_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    clusterId: uuid("cluster_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    metric: varchar("metric", { length: 255 }).notNull(),
    threshold: decimal("threshold", {
      precision: 10,
      scale: 2,
    }).notNull(),
    operator: varchar("operator", { length: 20 }).notNull(),
    duration: integer("duration").notNull(),
    severity: varchar("severity", { length: 50 }).default("warning"),
    isEnabled: boolean("is_enabled").default(true),
    conditions: jsonb("conditions"),
    notificationChannels: jsonb("notification_channels"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index("alert_policies_workspace_id_idx").on(
      table.workspaceId
    ),
    clusterIdx: index("alert_policies_cluster_id_idx").on(table.clusterId),
    enabledIdx: index("alert_policies_enabled_idx").on(table.isEnabled),
    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "alert_policies_workspace_id_fk",
    }).onDelete("cascade"),
    clusterFk: foreignKey({
      columns: [table.clusterId],
      foreignColumns: [clusters.id],
      name: "alert_policies_cluster_id_fk",
    }).onDelete("cascade"),
    createdByFk: foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "alert_policies_created_by_fk",
    }).onDelete("restrict"),
  })
);
