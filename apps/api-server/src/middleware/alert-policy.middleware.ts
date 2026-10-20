import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { alertPolicies, workspaceMembers, workspaces } from "../db/schema.js";
import { type WorkspaceRole } from "./auth.middleware.js";

export const requireAlertPolicyRole = (...allowedRoles: WorkspaceRole[]) =>
  async (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    const policyId = request.params.policyId as string;
    const result = await db
      .select({ role: workspaceMembers.role, ownerId: workspaces.ownerId })
      .from(alertPolicies)
      .innerJoin(workspaces, eq(alertPolicies.workspaceId, workspaces.id))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, alertPolicies.workspaceId),
          eq(workspaceMembers.userId, request.user.id)
        )
      )
      .where(eq(alertPolicies.id, policyId))
      .limit(1);
    const membership = result[0];

    if (!membership) {
      response.status(404).json({ error: "Alert policy not found" });
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