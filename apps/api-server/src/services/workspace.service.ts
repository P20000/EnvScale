import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, workspaceMembers, workspaces } from "../db/schema.js";
import type { WorkspaceRole } from "../middleware/auth.middleware.js";

export const listUserWorkspaces = async (userId: string) =>
  db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaces.isActive, true)));

export const ensureDefaultWorkspace = async (userId: string, userName: string) => {
  const existing = await listUserWorkspaces(userId);
  if (existing.length > 0) {
    return existing[0].workspace;
  }
  const cleanName = userName || "User";
  const baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
  const slug = `${baseSlug}-workspace-${userId.slice(0, 6)}`;
  return createWorkspace(userId, `${cleanName}'s Workspace`, slug, "Default personal workspace");
};

export const getWorkspace = async (workspaceId: string) => {
  const result = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return result[0];
};

export const getWorkspaceMembers = async (workspaceId: string) =>
  db
    .select({ user: users, role: workspaceMembers.role, joinedAt: workspaceMembers.joinedAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

export const createWorkspace = async (ownerId: string, name: string, slug: string, description?: string) =>
  db.transaction(async (transaction) => {
    const [workspace] = await transaction
      .insert(workspaces)
      .values({ ownerId, name, slug, description })
      .returning();
    await transaction.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: ownerId,
      role: "ADMIN",
    });
    return workspace;
  });

export const updateWorkspace = async (
  workspaceId: string,
  values: { name?: string; slug?: string; description?: string | null }
) => {
  const result = await db
    .update(workspaces)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return result[0];
};

export const deleteWorkspace = async (workspaceId: string) =>
  db.delete(workspaces).where(eq(workspaces.id, workspaceId));

export const addWorkspaceMember = async (workspaceId: string, userId: string, role: WorkspaceRole) => {
  const [member] = await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role })
    .returning();
  return member;
};

export const removeWorkspaceMember = async (workspaceId: string, userId: string) =>
  db
    .delete(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));