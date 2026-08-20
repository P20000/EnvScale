import { Router } from "express";
import { create, get, list, remove, toggle, update } from "../controllers/alert-policy.controller.js";
import { requireAlertPolicyRole } from "../middleware/alert-policy.middleware.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import {
  alertPolicyParamsSchema,
  alertPolicySchema,
  alertPolicyToggleSchema,
  updateAlertPolicySchema,
  workspaceParamsSchema,
} from "../schemas/request.schemas.js";

export const alertPolicyRouter = Router({ mergeParams: true });

alertPolicyRouter.use(requireAuth);
alertPolicyRouter.get(
  "/",
  validate("params", workspaceParamsSchema, "Invalid workspace parameters"),
  requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"),
  list
);
alertPolicyRouter.post(
  "/",
  validate("params", workspaceParamsSchema, "Invalid workspace parameters"),
  validate("body", alertPolicySchema, "Invalid alert policy data"),
  requireWorkspaceRole("ADMIN", "MEMBER"),
  create
);

export const topLevelAlertPolicyRouter = Router();
topLevelAlertPolicyRouter.use(requireAuth);
topLevelAlertPolicyRouter.get(
  "/:policyId",
  validate("params", alertPolicyParamsSchema, "Invalid alert policy parameters"),
  requireAlertPolicyRole("ADMIN", "MEMBER", "VIEWER"),
  get
);
topLevelAlertPolicyRouter.put(
  "/:policyId",
  validate("params", alertPolicyParamsSchema, "Invalid alert policy parameters"),
  validate("body", updateAlertPolicySchema, "Invalid alert policy data"),
  requireAlertPolicyRole("ADMIN", "MEMBER"),
  update
);
topLevelAlertPolicyRouter.delete(
  "/:policyId",
  validate("params", alertPolicyParamsSchema, "Invalid alert policy parameters"),
  requireAlertPolicyRole("ADMIN"),
  remove
);
topLevelAlertPolicyRouter.patch(
  "/:policyId/toggle",
  validate("params", alertPolicyParamsSchema, "Invalid alert policy parameters"),
  validate("body", alertPolicyToggleSchema, "Invalid alert policy toggle data"),
  requireAlertPolicyRole("ADMIN", "MEMBER"),
  toggle
);