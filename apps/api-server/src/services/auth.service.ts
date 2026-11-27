import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, eq, inArray, isNull } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../db/client.js";
import { clusters, refreshTokens, users, workspaceMembers, workspaces } from "../db/schema.js";

import { type WorkspaceRole } from "../middleware/auth.middleware.js";

const PLACEHOLDER_JWT_SECRETS = new Set([
  "default_dev_access_secret_do_not_use_in_prod",
  "default_dev_refresh_secret_do_not_use_in_prod",
  "replace-with-a-long-random-access-secret",
  "replace-with-a-different-long-random-refresh-secret",
]);

const getAccessTokenSecret = () => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error("JWT_ACCESS_SECRET is not configured");
  }
  if (process.env.NODE_ENV === "production" && PLACEHOLDER_JWT_SECRETS.has(secret.trim())) {
    throw new Error("JWT_ACCESS_SECRET uses a disallowed placeholder value in production");
  }
  return secret;
};

const getRefreshTokenSecret = () => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error("JWT_REFRESH_SECRET is not configured");
  }
  if (process.env.NODE_ENV === "production" && PLACEHOLDER_JWT_SECRETS.has(secret.trim())) {
    throw new Error("JWT_REFRESH_SECRET uses a disallowed placeholder value in production");
  }
  return secret;
};
const refreshTokenLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = typeof users.$inferSelect;

const usedManifestDownloadJtis = new Map<string, number>();
const MAX_TRACKED_MANIFEST_JTIS = 5000;

/**
 * Consumes a single-use manifest download JTI. Returns true on first use, false on replay.
 */
export const consumeManifestDownloadJti = (jti: string, expUnixSeconds?: number): boolean => {
  if (!jti) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [key, exp] of usedManifestDownloadJtis) {
    if (exp <= nowSec) {
      usedManifestDownloadJtis.delete(key);
    }
  }
  if (usedManifestDownloadJtis.has(jti)) {
    return false;
  }
  if (usedManifestDownloadJtis.size >= MAX_TRACKED_MANIFEST_JTIS) {
    const oldestKey = usedManifestDownloadJtis.keys().next().value;
    if (oldestKey) {
      usedManifestDownloadJtis.delete(oldestKey);
    }
  }
  const expiresAtSec = typeof expUnixSeconds === "number" && expUnixSeconds > nowSec ? expUnixSeconds : nowSec + 300;
  usedManifestDownloadJtis.set(jti, expiresAtSec);
  return true;
};

const rolePriority: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
};

export const hashPassword = (password: string) => bcrypt.hash(password, 12);

export const verifyPassword = (password: string, passwordHash: string) =>
  bcrypt.compare(password, passwordHash);

const hashRefreshToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const createAccessToken = (user: AuthUser, extraClaims?: Record<string, unknown>) =>
  jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tokenType: "user", ...(extraClaims || {}) },
    getAccessTokenSecret(),
    { expiresIn: "7d" }
  );

export const createStreamerToken = (user: AuthUser, clusterRoles: Record<string, WorkspaceRole>) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenType: "user",
      clusterRoles,
      allowedClusterIds: Object.keys(clusterRoles),
    },
    getAccessTokenSecret(),
    { expiresIn: "15m" }
  );

export const createServiceToken = (subject: string = "api-server") =>
  jwt.sign(
    { sub: subject, role: "SERVICE", tokenType: "service", allowedClusterIds: ["*"] },
    getAccessTokenSecret(),
    { expiresIn: "15m" }
  );

export const createAgentToken = (clusterId: string) =>
  jwt.sign(
    { sub: `agent-${clusterId}`, tokenType: "agent", clusterId },
    getAccessTokenSecret(),
    { expiresIn: "30d" }
  );

export const createManifestDownloadToken = (userId: string, clusterId: string) =>
  jwt.sign(
    {
      sub: userId,
      tokenType: "manifest_download",
      clusterId,
      jti: randomBytes(16).toString("hex"),
    },
    getAccessTokenSecret(),
    { expiresIn: "5m" }
  );

/**
 * Resolves the caller's effective WorkspaceRole per cluster UUID (including workspace ownership as ADMIN).
 * Never grants cross-workspace wildcards for global ADMIN users and never indexes by mutable cluster name.
 */
export const getUserClusterRoles = async (userId: string): Promise<Record<string, WorkspaceRole>> => {
  const userWorkspaces = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  const ownedWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerId, userId));

  const workspaceRoleMap = new Map<string, WorkspaceRole>();
  for (const owned of ownedWorkspaces) {
    if (owned.id) {
      workspaceRoleMap.set(owned.id, "ADMIN");
    }
  }
  for (const w of userWorkspaces) {
    const normalized = (w.role?.toUpperCase() || "VIEWER") as WorkspaceRole;
    if (normalized in rolePriority) {
      const existing = workspaceRoleMap.get(w.workspaceId);
      if (!existing || rolePriority[normalized] > rolePriority[existing]) {
        workspaceRoleMap.set(w.workspaceId, normalized);
      }
    }
  }

  const workspaceIds = Array.from(workspaceRoleMap.keys());
  if (workspaceIds.length === 0) {
    return {};
  }

  const clusterRows = await db
    .select({ id: clusters.id, workspaceId: clusters.workspaceId })
    .from(clusters)
    .where(inArray(clusters.workspaceId, workspaceIds));

  const clusterRoles: Record<string, WorkspaceRole> = {};
  for (const c of clusterRows) {
    const wsRole = workspaceRoleMap.get(c.workspaceId);
    if (!c.id || !wsRole) continue;
    const existing = clusterRoles[c.id];
    if (!existing || rolePriority[wsRole] > rolePriority[existing]) {
      clusterRoles[c.id] = wsRole;
    }
  }

  return clusterRoles;
};

export const getUserAccessibleClusterIds = async (userId: string, _role?: string | null): Promise<string[]> =>
  Object.keys(await getUserClusterRoles(userId));

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