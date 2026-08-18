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
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

import { relations } from "drizzle-orm";

// ============================================================================
// USERS TABLE
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    email: varchar("email", { length: 255 }).notNull().unique(),

    name: varchar("name", { length: 255 }).notNull(),

    passwordHash: text("password_hash").notNull(),

    avatar: varchar("avatar", { length: 500 }),

    role: varchar("role", { length: 50 }).default("user"),

    isActive: boolean("is_active").default(true),

    lastLogin: timestamp("last_login"),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),

    activeIdx: index("users_active_idx").on(table.isActive),
  })
);

// ============================================================================
// WORKSPACES TABLE
// ============================================================================

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    name: varchar("name", { length: 255 }).notNull(),

    slug: varchar("slug", { length: 255 }).notNull().unique(),

    description: text("description"),

    ownerId: uuid("owner_id").notNull(),

    logo: varchar("logo", { length: 500 }),

    metadata: jsonb("metadata"),

    isActive: boolean("is_active").default(true),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index("workspaces_owner_id_idx").on(table.ownerId),

    slugIdx: uniqueIndex("workspaces_slug_idx").on(table.slug),

    ownerFk: foreignKey({
      columns: [table.ownerId],
      foreignColumns: [users.id],
      name: "workspaces_owner_id_fk",
    }).onDelete("cascade"),
  })
);

// ============================================================================
// WORKSPACE MEMBERS TABLE
// ============================================================================

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull(),

    userId: uuid("user_id").notNull(),

    role: varchar("role", { length: 50 }).default("member"),

    joinedAt: timestamp("joined_at").defaultNow().notNull(),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceMemberPk: primaryKey({
      columns: [table.workspaceId, table.userId],
    }),

    workspaceIdx: index("workspace_members_workspace_id_idx").on(
      table.workspaceId
    ),

    userIdx: index("workspace_members_user_id_idx").on(table.userId),

    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "workspace_members_workspace_id_fk",
    }).onDelete("cascade"),

    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "workspace_members_user_id_fk",
    }).onDelete("cascade"),
  })
);

// ============================================================================
// CLUSTERS TABLE
// ============================================================================

export const clusters = pgTable(
  "clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    workspaceId: uuid("workspace_id").notNull(),

    name: varchar("name", { length: 255 }).notNull(),

    type: varchar("type", { length: 50 }).notNull(),

    kubeconfig: text("kubeconfig"),

    apiServerUrl: varchar("api_server_url", { length: 500 }),

    version: varchar("version", { length: 50 }),

    nodeCount: integer("node_count").default(0),

    healthScore: decimal("health_score", {
      precision: 5,
      scale: 2,
    }).default("0.00"),

    status: varchar("status", { length: 50 }).default("disconnected"),

    lastSyncAt: timestamp("last_sync_at"),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index("clusters_workspace_id_idx").on(table.workspaceId),

    statusIdx: index("clusters_status_idx").on(table.status),

    workspaceFk: foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "clusters_workspace_id_fk",
    }).onDelete("cascade"),
  })
);

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

// ============================================================================
// HEALTH SNAPSHOTS TABLE
// ============================================================================

export const healthSnapshots = pgTable(
  "health_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    clusterId: uuid("cluster_id").notNull(),

    healthScore: decimal("health_score", {
      precision: 5,
      scale: 2,
    }).notNull(),

    timestamp: timestamp("timestamp").defaultNow().notNull(),

    details: jsonb("details"),

    podStatus: jsonb("pod_status"),

    nodeStatus: jsonb("node_status"),

    networkStatus: jsonb("network_status"),

    storageStatus: jsonb("storage_status"),

    uptime: decimal("uptime", {
      precision: 5,
      scale: 2,
    }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    clusterIdx: index("health_snapshots_cluster_id_idx").on(
      table.clusterId
    ),

    timestampIdx: index("health_snapshots_timestamp_idx").on(
      table.timestamp
    ),

    clusterTimestampIdx: index(
      "health_snapshots_cluster_timestamp_idx"
    ).on(table.clusterId, table.timestamp),

    clusterFk: foreignKey({
      columns: [table.clusterId],
      foreignColumns: [clusters.id],
      name: "health_snapshots_cluster_id_fk",
    }).onDelete("cascade"),
  })
);

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
