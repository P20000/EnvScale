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
import { fromNodeHeaders } from "better-auth/node";

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  // 1. Check Bearer JWT token first (explicit client-specified session or query param for kubectl / curl)
  const header = request.header("authorization");
  const token = (header?.startsWith("Bearer ") ? header.slice(7) : undefined) || (typeof request.query.token === "string" ? request.query.token : undefined);
  const secret = process.env.JWT_ACCESS_SECRET;

  if (token && secret) {
    try {
      const payload = jwt.verify(token, secret);
      if (typeof payload === "object" && typeof payload.sub === "string") {
        // Recognize internal system service tokens (e.g. k8s-streamer -> api-server)
        if (payload.sub === "k8s-streamer" || payload.sub === "api-server") {
          request.user = {
            id: payload.sub,
            name: "System Service",
            email: `${payload.sub}@envscale.internal`,
            role: "ADMIN",
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            passwordHash: "",
            avatar: null,
          } as any;
          next();
          return;
        }

        const user = await getUserById(payload.sub);
        if (user && user.isActive !== false) {
          request.user = user;
          next();
          return;
        }
      }
    } catch {
      // If Bearer token is invalid or expired, continue to fallback checks
    }
  }

  // 2. Fallback to Better Auth session cookie (e.g., initial OAuth setup / streamer-token fetch)
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (session?.user) {
      const dbUser = await getUserById(session.user.id);
      if (dbUser && dbUser.isActive !== false) {
        request.user = dbUser;
        next();
        return;
      }
    }
  } catch {
    // Session check failed
  }

  response.status(401).json({ error: "Authentication required" });
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