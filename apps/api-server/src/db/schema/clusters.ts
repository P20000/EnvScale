import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  decimal,
  uuid,
  jsonb,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

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
    clusterCreatedAtIdx: index(
      "health_snapshots_cluster_created_at_idx"
    ).on(table.clusterId, table.createdAt),
    clusterFk: foreignKey({
      columns: [table.clusterId],
      foreignColumns: [clusters.id],
      name: "health_snapshots_cluster_id_fk",
    }).onDelete("cascade"),
  })
);
