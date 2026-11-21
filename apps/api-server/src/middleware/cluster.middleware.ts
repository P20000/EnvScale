import type { NextFunction, Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { clusters, workspaceMembers, workspaces } from "../db/schema.js";
import { type WorkspaceRole } from "./auth.middleware.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireClusterRole = (...allowedRoles: WorkspaceRole[]) =>
  async (request: Request, response: Response, next: NextFunction) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required" });
      return;
    }

    if (request.isServiceToken) {
      response.status(403).json({ error: "User workspace membership required" });
      return;
    }

    const clusterId = request.params.clusterId;
    if (typeof clusterId !== "string" || !clusterId.trim()) {
      response.status(400).json({ error: "Cluster id is required" });
      return;
    }

    const workspaceId = typeof request.params.id === "string" ? request.params.id : undefined;
    const idOrNameCondition = UUID_REGEX.test(clusterId)
      ? or(eq(clusters.id, clusterId), eq(clusters.name, clusterId))
      : eq(clusters.name, clusterId);

    const whereClause = workspaceId
      ? and(idOrNameCondition, eq(clusters.workspaceId, workspaceId))
      : idOrNameCondition;

    const rows = await db
      .select({
        clusterId: clusters.id,
        workspaceId: clusters.workspaceId,
        ownerId: workspaces.ownerId,
        memberRole: workspaceMembers.role,
      })
      .from(clusters)
      .innerJoin(workspaces, eq(clusters.workspaceId, workspaces.id))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, clusters.workspaceId),
          eq(workspaceMembers.userId, request.user.id)
        )
      )
      .where(whereClause);

    if (rows.length === 0) {
      response.status(404).json({ error: "Cluster not found" });
      return;
    }

    const callerId = request.user.id;
    const memberRows = rows.filter((row) => row.ownerId === callerId || Boolean(row.memberRole));
    if (memberRows.length === 0) {
      response.status(403).json({ error: "Cluster access denied" });
      return;
    }

    const candidates = memberRows.map((row) => ({
      row,
      role: (row.ownerId === callerId ? "ADMIN" : row.memberRole?.toUpperCase()) as WorkspaceRole | undefined,
    }));

    const matched = candidates.find((c) => Boolean(c.role && allowedRoles.includes(c.role))) || candidates[0];
    if (!matched.role || !allowedRoles.includes(matched.role)) {
      response.status(403).json({ error: "Insufficient workspace permissions" });
      return;
    }

    request.workspaceRole = matched.role;
    request.authorizedClusterId = matched.row.clusterId;
    request.authorizedWorkspaceId = matched.row.workspaceId;
    next();
  };

