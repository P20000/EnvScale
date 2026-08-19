import type { Request, Response } from "express";
import { z } from "zod";
import {
  findUserByEmail,
  getUserById,
  issueTokens,
  registerUser,
  rotateRefreshToken,
  verifyPassword,
} from "../services/auth.service.js";

const credentialsSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(255),
});

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
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid registration data", details: parsed.error.flatten() });
    return;
  }
  if (await findUserByEmail(parsed.data.email)) {
    response.status(409).json({ error: "Email is already registered" });
    return;
  }

  try {
    const user = await registerUser(parsed.data.name, parsed.data.email, parsed.data.password);
    const tokens = await issueTokens(user);
    setRefreshCookie(response, tokens.refreshToken);
    response.status(201).json({ accessToken: tokens.accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error(error);
    response.status(500).json({ error: "Unable to register user" });
  }
};

export const login = async (request: Request, response: Response) => {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid login data", details: parsed.error.flatten() });
    return;
  }
  const user = await findUserByEmail(parsed.data.email);
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    response.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const tokens = await issueTokens(user);
  setRefreshCookie(response, tokens.refreshToken);
  response.json({ accessToken: tokens.accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
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
  response.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
};