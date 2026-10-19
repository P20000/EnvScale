import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, inArray, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../db/client.js";
import { clusters, refreshTokens, users, workspaceMembers } from "../db/schema.js";

const getAccessTokenSecret = () =>
  process.env.JWT_ACCESS_SECRET || "default_dev_access_secret_do_not_use_in_prod";
const getRefreshTokenSecret = () =>
  process.env.JWT_REFRESH_SECRET || "default_dev_refresh_secret_do_not_use_in_prod";
const refreshTokenLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = typeof users.$inferSelect;

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export const verifyPassword = (password: string, passwordHash: string) =>
  bcrypt.compare(password, passwordHash);

const hashRefreshToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const createAccessToken = (user: AuthUser, extraClaims?: Record<string, unknown>) =>
  jwt.sign(
    { sub: user.id, email: user.email, role: user.role, ...(extraClaims || {}) },
    getAccessTokenSecret(),
    { expiresIn: "7d" }
  );

export const createServiceToken = (subject: string = "api-server") =>
  jwt.sign(
    { sub: subject, role: "ADMIN", allowedClusterIds: ["*"] },
    getAccessTokenSecret(),
    { expiresIn: "1h" }
  );

export const getUserAccessibleClusterIds = async (userId: string, role?: string | null): Promise<string[]> => {
  if (role && role.toUpperCase() === "ADMIN") {
    return ["*"];
  }

  // Find all workspaces where user is a member or owner
  const userWorkspaces = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  const workspaceIds = userWorkspaces.map((w) => w.workspaceId);
  if (workspaceIds.length === 0) {
    return [];
  }

  // Find all clusters in these workspaces
  const clusterRows = await db
    .select({ id: clusters.id, name: clusters.name })
    .from(clusters)
    .where(inArray(clusters.workspaceId, workspaceIds));

  // Include both UUIDs and cluster names so client can authorize by ID or name
  const allowed = new Set<string>();
  for (const c of clusterRows) {
    if (c.id) allowed.add(c.id);
    if (c.name) allowed.add(c.name);
  }
  return Array.from(allowed);
};

const createRefreshToken = async (userId: string) => {
  const token = randomBytes(48).toString("base64url");
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
  });
  return token;
};

export const issueTokens = async (user: AuthUser) => ({
  accessToken: createAccessToken(user),
  refreshToken: await createRefreshToken(user.id),
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const findUserByEmail = async (email: string) => {
  if (!email) return undefined;
  const normEmail = email.trim().toLowerCase();
  const result = await db.select().from(users).where(eq(users.email, normEmail)).limit(1);
  if (result[0]) return result[0];
  const exact = await db.select().from(users).where(eq(users.email, email.trim())).limit(1);
  return exact[0];
};

export const registerUser = async (name: string, email: string, password: string) => {
  const passwordHash = await hashPassword(password);
  const result = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .returning();
  return result[0];
};

export const rotateRefreshToken = async (token: string) => {
  const tokenHash = hashRefreshToken(token);
  const result = await db
    .select({ token: refreshTokens, user: users })
    .from(refreshTokens)
    .innerJoin(users, eq(refreshTokens.userId, users.id))
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  const current = result[0];

  if (!current || current.token.expiresAt <= new Date()) {
    return undefined;
  }

  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, current.token.id));
  return issueTokens(current.user);
};

export const getUserById = async (id: string) => {
  if (!id || !UUID_REGEX.test(id)) {
    return undefined;
  }
  const result = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.isActive, true)))
    .limit(1);
  return result[0];
};