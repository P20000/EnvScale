import type { Request, Response } from "express";
import {
  findUserByEmail,
  getUserById,
  getUserClusterRoles,
  issueTokens,
  createAccessToken,
  createStreamerToken,
  registerUser,
  rotateRefreshToken,
  verifyPassword,
} from "../services/auth.service.js";

import { ensureDefaultWorkspace } from "../services/workspace.service.js";

const setRefreshCookie = (response: Response, token: string) => {
  response.cookie("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

export const register = async (request: Request, response: Response) => {
  const { name, email, password } = request.body as { name: string; email: string; password: string };
  if (await findUserByEmail(email)) {
    response.status(409).json({ error: "Email is already registered" });
    return;
  }

  try {
    const user = await registerUser(name, email, password);
    const workspace = await ensureDefaultWorkspace(user.id, user.name);
    const tokens = await issueTokens(user);
    setRefreshCookie(response, tokens.refreshToken);
    response.status(201).json({
      accessToken: tokens.accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      workspace,
    });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Unable to register user" });
  }
};

export const login = async (request: Request, response: Response) => {
  const { email, password } = request.body as { email: string; password: string };
  const user = await findUserByEmail(email);
  
  if (!user || !user.isActive) {
    response.status(401).json({ error: "Invalid email or password" });
    return;
  }
  
  if (!user.passwordHash) {
    response.status(401).json({ error: "This account uses social login. Please sign in with Google or GitHub." });
    return;
  }
  
  if (!(await verifyPassword(password, user.passwordHash))) {
    response.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const workspace = await ensureDefaultWorkspace(user.id, user.name);
  const tokens = await issueTokens(user);
  setRefreshCookie(response, tokens.refreshToken);
  response.json({
    accessToken: tokens.accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    workspace,
  });
};

export const refresh = async (request: Request, response: Response) => {
  const token = request.cookies.refreshToken as string | undefined;
  if (!token) {
    response.status(401).json({ error: "Refresh token required" });
    return;
  }
  const tokens = await rotateRefreshToken(token);
  if (!tokens) {
    response.clearCookie("refreshToken", { path: "/api/v1/auth" });
    response.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }
  setRefreshCookie(response, tokens.refreshToken);
  response.json({ accessToken: tokens.accessToken });
};

export const me = async (request: Request, response: Response) => {
  const user = request.user?.id ? await getUserById(request.user.id) : undefined;
  if (!user) {
    response.status(401).json({ error: "User unavailable" });
    return;
  }
  const workspace = await ensureDefaultWorkspace(user.id, user.name);
  response.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    workspace,
  });
};

export const getStreamerToken = async (request: Request, response: Response) => {
  if (!request.user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }
  const clusterRoles = await getUserClusterRoles(request.user.id);
  const allowedClusterIds = Object.keys(clusterRoles);
  const token = createStreamerToken(request.user, clusterRoles);
  response.json({ token, allowedClusterIds, clusterRoles });
};

export const switchSession = async (request: Request, response: Response) => {
  try {
    if (!request.user || request.isServiceToken) {
      response.status(403).json({ error: "User session authentication required" });
      return;
    }

    const caller = await getUserById(request.user.id);
    if (!caller || caller.isActive === false) {
      response.status(401).json({ error: "User unavailable" });
      return;
    }

    const { accountId, email } = request.body as { accountId?: string; email?: string };
    if (
      (accountId && accountId !== caller.id) ||
      (email && email.toLowerCase() !== caller.email.toLowerCase())
    ) {
      response.status(403).json({ error: "Cannot switch to another user's session" });
      return;
    }

    const clusterRoles = await getUserClusterRoles(caller.id);
    const allowedClusterIds = Object.keys(clusterRoles);
    const token = createAccessToken(caller, { tokenType: "user", clusterRoles, allowedClusterIds });
    const workspace = await ensureDefaultWorkspace(caller.id, caller.name);

    response.json({
      token,
      user: { id: caller.id, name: caller.name, email: caller.email, role: caller.role },
      workspace,
      allowedClusterIds,
      clusterRoles,
    });
  } catch (error) {
    console.error("switchSession handler error:", error);
    response.status(500).json({ error: "Failed to switch user session" });
  }
};