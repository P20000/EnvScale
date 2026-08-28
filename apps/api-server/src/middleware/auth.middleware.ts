import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { workspaceMembers, workspaces } from "../db/schema.js";
import { getUserById } from "../services/auth.service.js";

export const workspaceRoles = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

declare global {
  namespace Express {
    interface Request {
      user?: Awaited<ReturnType<typeof getUserById>>;
      workspaceRole?: WorkspaceRole;
    }
  }
}

import { auth } from "../lib/auth.js";

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  try {
    // 1. Check Better Auth session from request headers / cookies
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      const dbUser = await getUserById(session.user.id);
      if (dbUser && dbUser.isActive !== false) {
        request.user = dbUser;
        next();
        return;
      }
    }
  } catch {
    // Session check fallback to Bearer JWT token verification
  }

  // 2. Check Bearer JWT token fallback
  const header = request.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!token || !secret) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      response.status(401).json({ error: "Invalid access token" });
      return;
    }
    const user = await getUserById(payload.sub);
    if (!user) {
      response.status(401).json({ error: "User is inactive or unavailable" });
      return;
    }
    request.user = user;
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired access token" });
  }
};

export const requireWorkspaceRole = (...allowedRoles: WorkspaceRole[]) =>
  async (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    const workspaceId = request.params.id;
    if (typeof workspaceId !== "string") {
      response.status(400).json({ error: "Workspace id is required" });
      return;
    }

    const result = await db
      .select({ role: workspaceMembers.role, ownerId: workspaces.ownerId })
      .from(workspaces)
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaces.id),
          eq(workspaceMembers.userId, request.user.id)
        )
      )
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const membership = result[0];

    if (!membership || (!membership.role && membership.ownerId !== request.user.id)) {
      response.status(403).json({ error: "Workspace access denied" });
      return;
    }

    const role = (membership.ownerId === request.user.id
      ? "ADMIN"
      : membership.role?.toUpperCase()) as WorkspaceRole | undefined;
    if (!role || !allowedRoles.includes(role)) {
      response.status(403).json({ error: "Insufficient workspace permissions" });
      return;
    }

    request.workspaceRole = role;
    next();
  };