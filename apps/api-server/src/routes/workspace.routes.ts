import { Router } from "express";
import { addMember, create, get, list, remove, removeMember, update } from "../controllers/workspace.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { memberParamsSchema, memberSchema, updateWorkspaceSchema, workspaceParamsSchema, workspaceSchema } from "../schemas/request.schemas.js";

export const workspaceRouter: Router = Router();

workspaceRouter.use(requireAuth);
workspaceRouter.get("/", list);
workspaceRouter.post("/", validate("body", workspaceSchema, "Invalid workspace data"), create);
workspaceRouter.get("/:id", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"), get);
workspaceRouter.put("/:id", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), validate("body", updateWorkspaceSchema, "Invalid workspace data"), requireWorkspaceRole("ADMIN"), update);
workspaceRouter.delete("/:id", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), requireWorkspaceRole("ADMIN"), remove);
workspaceRouter.post("/:id/members", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), validate("body", memberSchema, "Invalid member data"), requireWorkspaceRole("ADMIN"), addMember);
workspaceRouter.delete("/:id/members/:userId", validate("params", memberParamsSchema, "Invalid member parameters"), requireWorkspaceRole("ADMIN"), removeMember);