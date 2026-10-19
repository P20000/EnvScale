import { Router } from "express";
import { connect, list, remove, getLayout, saveLayout, resetLayout } from "../controllers/cluster.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.js";
import {
  clusterConnectSchema,
  clusterParamsSchema,
  topLevelClusterParamsSchema,
  workspaceParamsSchema,
  clusterLayoutParamSchema,
  clusterLayoutSchema,
} from "../schemas/request.schemas.js";

export const clusterRouter: Router = Router({ mergeParams: true });

clusterRouter.use(requireAuth);
clusterRouter.get("/", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"), list);
clusterRouter.post("/connect", validate("params", workspaceParamsSchema, "Invalid workspace parameters"), validate("body", clusterConnectSchema, "Invalid cluster data"), requireWorkspaceRole("ADMIN", "MEMBER"), connect);
clusterRouter.delete("/:clusterId", validate("params", clusterParamsSchema, "Invalid cluster parameters"), requireWorkspaceRole("ADMIN"), remove);
clusterRouter.get("/:clusterId/layout", getLayout);
clusterRouter.put("/:clusterId/layout", validate("body", clusterLayoutSchema, "Invalid layout data"), saveLayout);
clusterRouter.delete("/:clusterId/layout", resetLayout);

export const topLevelClusterRouter: Router = Router();
topLevelClusterRouter.use(requireAuth);
topLevelClusterRouter.post("/", validate("body", clusterConnectSchema, "Invalid cluster data"), connect);
topLevelClusterRouter.post("/connect", validate("body", clusterConnectSchema, "Invalid cluster data"), connect);
topLevelClusterRouter.delete("/:clusterId", validate("params", topLevelClusterParamsSchema, "Invalid cluster parameters"), remove);
topLevelClusterRouter.get("/:clusterId/layout", validate("params", clusterLayoutParamSchema, "Invalid cluster parameter"), getLayout);
topLevelClusterRouter.put("/:clusterId/layout", validate("params", clusterLayoutParamSchema, "Invalid cluster parameter"), validate("body", clusterLayoutSchema, "Invalid layout data"), saveLayout);
topLevelClusterRouter.delete("/:clusterId/layout", validate("params", clusterLayoutParamSchema, "Invalid cluster parameter"), resetLayout);