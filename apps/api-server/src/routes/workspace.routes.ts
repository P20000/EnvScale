import { Router } from "express";
import { addMember, create, get, list, remove, removeMember, update } from "../controllers/workspace.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);
workspaceRouter.get("/", list);
workspaceRouter.post("/", create);
workspaceRouter.get("/:id", requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"), get);
workspaceRouter.put("/:id", requireWorkspaceRole("ADMIN"), update);
workspaceRouter.delete("/:id", requireWorkspaceRole("ADMIN"), remove);
workspaceRouter.post("/:id/members", requireWorkspaceRole("ADMIN"), addMember);
workspaceRouter.delete("/:id/members/:userId", requireWorkspaceRole("ADMIN"), removeMember);