import { Router } from "express";
import { list, resolve } from "../controllers/incident.controller.js";
import { requireIncidentRole } from "../middleware/incident.middleware.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import {
  incidentParamsSchema,
  incidentResolveSchema,
  workspaceParamsSchema,
} from "../schemas/request.schemas.js";

export const incidentRouter = Router({ mergeParams: true });
incidentRouter.use(requireAuth);
incidentRouter.get(
  "/",
  validate("params", workspaceParamsSchema, "Invalid workspace parameters"),
  requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"),
  list
);

export const topLevelIncidentRouter = Router();
topLevelIncidentRouter.use(requireAuth);
topLevelIncidentRouter.patch(
  "/:incidentId/resolve",
  validate("params", incidentParamsSchema, "Invalid incident parameters"),
  validate("body", incidentResolveSchema, "Invalid incident resolution data"),
  requireIncidentRole("ADMIN", "MEMBER"),
  resolve
);