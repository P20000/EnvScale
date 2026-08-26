import type { Request, Response } from "express";
import type { WorkspaceRole } from "../middleware/auth.middleware.js";
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

const generateSlug = (name: string): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `workspace-${Date.now().toString(36)}`;
};

const publicUser = (user: { id: string; name: string; email: string; avatar: string | null }) =>
  ({ id: user.id, name: user.name, email: user.email, avatar: user.avatar });

export const list = async (request: Request, response: Response) => {
  const workspaces = await listUserWorkspaces(request.user!.id);
  response.json(workspaces.map(({ workspace, role }) => ({ ...workspace, role: role?.toUpperCase() })));
};

export const create = async (request: Request, response: Response) => {
  const { name, slug: requestedSlug, description } = request.body as { name: string; slug?: string; description?: string };
  const slug = requestedSlug || generateSlug(name);
  try {
    const workspace = await createWorkspace(request.user!.id, name, slug, description);
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
  const workspaceId = request.params.id as string;
  const workspace = await getWorkspace(workspaceId);
  const members = await getWorkspaceMembers(workspaceId);
  response.json({ ...workspace, role: request.workspaceRole, members: members.map(({ user, role, joinedAt }) => ({ user: publicUser(user), role: role?.toUpperCase(), joinedAt })) });
};

export const update = async (request: Request, response: Response) => {
  const workspaceId = request.params.id as string;
  try {
    response.json(await updateWorkspace(workspaceId, request.body));
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "Workspace slug is already in use" });
      return;
    }
    throw error;
  }
};

export const remove = async (request: Request, response: Response) => {
  const workspaceId = request.params.id as string;
  await deleteWorkspace(workspaceId);
  response.status(204).send();
};

export const addMember = async (request: Request, response: Response) => {
  const workspaceId = request.params.id as string;
  const { userId, role } = request.body as { userId: string; role: WorkspaceRole };
  try {
    response.status(201).json(await addWorkspaceMember(workspaceId, userId, role));
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error.code === "23505" || error.code === "23503")) {
      response.status(error.code === "23505" ? 409 : 404).json({ error: error.code === "23505" ? "User is already a workspace member" : "User or workspace not found" });
      return;
    }
    throw error;
  }
};

export const removeMember = async (request: Request, response: Response) => {
  const workspaceId = request.params.id as string;
  const userId = request.params.userId as string;
  if (userId === request.user!.id) {
    response.status(400).json({ error: "An admin cannot remove themselves" });
    return;
  }
  await removeWorkspaceMember(workspaceId, userId);
  response.status(204).send();
};