import { Router } from "express";
import { connect, list, remove } from "../controllers/cluster.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import { clusterConnectSchema, clusterParamsSchema, workspaceParamsSchema } from "../schemas/request.schemas.js";

export const clusterRouter = Router({ mergeParams: true });

clusterRouter.use(requireAuth);
clusterRouter.get("/", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"), list);
clusterRouter.post("/connect", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), validate("body", clusterConnectSchema, "Invalid cluster data"), requireWorkspaceRole("ADMIN", "MEMBER"), connect);
clusterRouter.delete("/:clusterId", validate("params", clusterParamsSchema, "Invalid cluster parameters"), requireWorkspaceRole("ADMIN"), remove);