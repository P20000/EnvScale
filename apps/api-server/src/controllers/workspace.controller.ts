import type { Request, Response } from "express";
import { z } from "zod";
import { workspaceRoles, type WorkspaceRole } from "../middleware/auth.middleware.js";
import {
  addWorkspaceMember,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  getWorkspaceMembers,
  listUserWorkspaces,
  removeWorkspaceMember,
  updateWorkspace,
} from "../services/workspace.service.js";

const idSchema = z.string().uuid();
const roleSchema = z.enum(workspaceRoles);
const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(5000).optional(),
});
const updateSchema = workspaceSchema.partial().extend({ description: z.string().trim().max(5000).nullable().optional() });
const memberSchema = z.object({ userId: idSchema, role: roleSchema });

const publicUser = (user: { id: string; name: string; email: string; avatar: string | null }) =>
  ({ id: user.id, name: user.name, email: user.email, avatar: user.avatar });

const parseId = (request: Request, response: Response) => {
  const parsed = idSchema.safeParse(request.params.id);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid workspace id" });
    return undefined;
  }
  return parsed.data;
};

export const list = async (request: Request, response: Response) => {
  const workspaces = await listUserWorkspaces(request.user!.id);
  response.json(workspaces.map(({ workspace, role }) => ({ ...workspace, role: role?.toUpperCase() })));
};

export const create = async (request: Request, response: Response) => {
  const parsed = workspaceSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid workspace data", details: parsed.error.flatten() });
    return;
  }
  try {
    const workspace = await createWorkspace(request.user!.id, parsed.data.name, parsed.data.slug, parsed.data.description);
    response.status(201).json({ ...workspace, role: "ADMIN" });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "Workspace slug is already in use" });
      return;
    }
    throw error;
  }
};

export const get = async (request: Request, response: Response) => {
  const workspaceId = parseId(request, response);
  if (!workspaceId) return;
  const workspace = await getWorkspace(workspaceId);
  const members = await getWorkspaceMembers(workspaceId);
  response.json({ ...workspace, role: request.workspaceRole, members: members.map(({ user, role, joinedAt }) => ({ user: publicUser(user), role: role?.toUpperCase(), joinedAt })) });
};

export const update = async (request: Request, response: Response) => {
  const workspaceId = parseId(request, response);
  const parsed = updateSchema.safeParse(request.body);
  if (!workspaceId) return;
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid workspace data", details: parsed.error.flatten() });
    return;
  }
  try {
    response.json(await updateWorkspace(workspaceId, parsed.data));
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "Workspace slug is already in use" });
      return;
    }
    throw error;
  }
};

export const remove = async (request: Request, response: Response) => {
  const workspaceId = parseId(request, response);
  if (!workspaceId) return;
  await deleteWorkspace(workspaceId);
  response.status(204).send();
};

export const addMember = async (request: Request, response: Response) => {
  const workspaceId = parseId(request, response);
  const parsed = memberSchema.safeParse(request.body);
  if (!workspaceId) return;
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid member data", details: parsed.error.flatten() });
    return;
  }
  try {
    response.status(201).json(await addWorkspaceMember(workspaceId, parsed.data.userId, parsed.data.role as WorkspaceRole));
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error.code === "23505" || error.code === "23503")) {
      response.status(error.code === "23505" ? 409 : 404).json({ error: error.code === "23505" ? "User is already a workspace member" : "User or workspace not found" });
      return;
    }
    throw error;
  }
};

export const removeMember = async (request: Request, response: Response) => {
  const workspaceId = parseId(request, response);
  const parsedUserId = idSchema.safeParse(request.params.userId);
  if (!workspaceId) return;
  if (!parsedUserId.success) {
    response.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (parsedUserId.data === request.user!.id) {
    response.status(400).json({ error: "An admin cannot remove themselves" });
    return;
  }
  await removeWorkspaceMember(workspaceId, parsedUserId.data);
  response.status(204).send();
};