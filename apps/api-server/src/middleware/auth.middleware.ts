import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { workspaceMembers, workspaces } from "../db/schema.js";
import { type AuthUser, getUserById } from "../services/auth.service.js";

export const workspaceRoles = ["ADMIN", "MEMBER", "VIEWER"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      workspaceRole?: WorkspaceRole;
      isServiceToken?: boolean;
      serviceSubject?: "k8s-streamer" | "api-server";
      authorizedClusterId?: string;
      authorizedWorkspaceId?: string;
    }
  }
}

import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  // 1. Check Bearer JWT token first (explicit client-specified session or query param for kubectl / curl)
  const header = request.header("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const queryToken = typeof request.query.token === "string" ? request.query.token : undefined;
  const token = bearerToken || queryToken;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (token && secret) {
    try {
      const payload = jwt.verify(token, secret);
      if (typeof payload === "object" && typeof payload.sub === "string") {
        // Recognize internal system service tokens via Bearer header only (never query params)
        if (bearerToken && (payload.sub === "k8s-streamer" || payload.sub === "api-server")) {
          request.isServiceToken = true;
          request.serviceSubject = payload.sub;
          request.user = {
            id: payload.sub,
            name: "System Service",
            email: `${payload.sub}@envscale.internal`,
            role: "SERVICE",
            emailVerified: true,
            image: null,
            isActive: true,
            lastLogin: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            passwordHash: "",
            avatar: null,
          } as AuthUser;
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

export const requireServiceAuth = (request: Request, response: Response, next: NextFunction) => {
  if (!request.user || !request.isServiceToken || request.user.role !== "SERVICE") {
    response.status(403).json({ error: "Internal service authentication required" });
    return;
  }
  next();
};

export const requireWorkspaceRole = (...allowedRoles: WorkspaceRole[]) =>
  async (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    if (request.isServiceToken) {
      response.status(403).json({ error: "Workspace access denied" });
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