import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { incidents, workspaceMembers, workspaces } from "../db/schema.js";
import { type WorkspaceRole } from "./auth.middleware.js";

export const requireIncidentRole = (...allowedRoles: WorkspaceRole[]) =>
  async (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    const result = await db
      .select({ role: workspaceMembers.role, ownerId: workspaces.ownerId })
      .from(incidents)
      .innerJoin(workspaces, eq(incidents.workspaceId, workspaces.id))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, incidents.workspaceId),
          eq(workspaceMembers.userId, request.user.id)
        )
      )
      .where(eq(incidents.id, request.params.incidentId as string))
      .limit(1);
    const membership = result[0];

    if (!membership) {
      response.status(404).json({ error: "Incident not found" });
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