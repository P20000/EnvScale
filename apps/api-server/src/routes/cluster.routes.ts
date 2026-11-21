import { Router } from "express";
import { connect, list, remove, getLayout, saveLayout, resetLayout, getAgentManifest } from "../controllers/cluster.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";
import { requireClusterRole } from "../middleware/cluster.middleware.js";
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
clusterRouter.get("/:clusterId/agent.yaml", validate("params", clusterParamsSchema, "Invalid cluster parameters"), requireClusterRole("ADMIN", "MEMBER"), getAgentManifest);
clusterRouter.get("/:clusterId/layout", validate("params", clusterParamsSchema, "Invalid cluster parameters"), requireClusterRole("ADMIN", "MEMBER", "VIEWER"), getLayout);
clusterRouter.put("/:clusterId/layout", validate("params", clusterParamsSchema, "Invalid cluster parameters"), validate("body", clusterLayoutSchema, "Invalid layout data"), requireClusterRole("ADMIN", "MEMBER"), saveLayout);
clusterRouter.delete("/:clusterId/layout", validate("params", clusterParamsSchema, "Invalid cluster parameters"), requireClusterRole("ADMIN", "MEMBER"), resetLayout);

export const topLevelClusterRouter: Router = Router();
topLevelClusterRouter.use(requireAuth);
topLevelClusterRouter.get("/", list);
topLevelClusterRouter.post("/", validate("body", clusterConnectSchema, "Invalid cluster data"), connect);
topLevelClusterRouter.post("/connect", validate("body", clusterConnectSchema, "Invalid cluster data"), connect);
topLevelClusterRouter.get("/:clusterId/agent.yaml", validate("params", topLevelClusterParamsSchema, "Invalid cluster parameters"), requireClusterRole("ADMIN", "MEMBER"), getAgentManifest);
topLevelClusterRouter.delete("/:clusterId", validate("params", topLevelClusterParamsSchema, "Invalid cluster parameters"), remove);
topLevelClusterRouter.get("/:clusterId/layout", validate("params", clusterLayoutParamSchema, "Invalid cluster parameter"), requireClusterRole("ADMIN", "MEMBER", "VIEWER"), getLayout);
topLevelClusterRouter.put("/:clusterId/layout", validate("params", clusterLayoutParamSchema, "Invalid cluster parameter"), validate("body", clusterLayoutSchema, "Invalid layout data"), requireClusterRole("ADMIN", "MEMBER"), saveLayout);
topLevelClusterRouter.delete("/:clusterId/layout", validate("params", clusterLayoutParamSchema, "Invalid cluster parameter"), requireClusterRole("ADMIN", "MEMBER"), resetLayout);