import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  uuid,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";

// ============================================================================
// USERS TABLE
// ============================================================================

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    passwordHash: text("password_hash"),
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

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("refresh_tokens_user_id_idx").on(table.userId),
    tokenHashIdx: uniqueIndex("refresh_tokens_token_hash_idx").on(
      table.tokenHash
    ),
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "refresh_tokens_user_id_fk",
    }).onDelete("cascade"),
  })
);
