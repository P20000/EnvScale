import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  uuid,
  jsonb,
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

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
    role: varchar("role", { length: 50 }).default("MEMBER"),
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
