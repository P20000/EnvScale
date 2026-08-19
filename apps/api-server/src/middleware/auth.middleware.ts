import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getUserById } from "../services/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      user?: Awaited<ReturnType<typeof getUserById>>;
    }
  }
}

export const requireAuth = async (request: Request, response: Response, next: NextFunction) => {
  const header = request.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!token || !secret) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      response.status(401).json({ error: "Invalid access token" });
      return;
    }
    const user = await getUserById(payload.sub);
    if (!user) {
      response.status(401).json({ error: "User is inactive or unavailable" });
      return;
    }
    request.user = user;
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired access token" });
  }
};