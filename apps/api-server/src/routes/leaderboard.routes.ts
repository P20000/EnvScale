import { Router } from "express";
import { healthHistory, leaderboard } from "../controllers/leaderboard.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { healthHistoryQuerySchema, workspaceParamsSchema } from "../schemas/request.schemas.js";

export const leaderboardRouter: Router = Router();
leaderboardRouter.use(requireAuth);
leaderboardRouter.get("/", leaderboard);

export const healthHistoryRouter: Router = Router({ mergeParams: true });
healthHistoryRouter.use(requireAuth);
healthHistoryRouter.get(
  "/",
  validate("params", workspaceParamsSchema, "Invalid workspace parameters"),
  validate("query", healthHistoryQuerySchema, "Invalid health history query"),
  requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"),
  healthHistory
);