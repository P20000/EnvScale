import { Router } from "express";
import { connect, list, remove } from "../controllers/cluster.controller.js";
import { requireAuth, requireWorkspaceRole } from "../middleware/auth.middleware.js";

export const clusterRouter = Router({ mergeParams: true });

clusterRouter.use(requireAuth);
clusterRouter.get("/", requireWorkspaceRole("ADMIN", "MEMBER", "VIEWER"), list);
clusterRouter.post("/connect", requireWorkspaceRole("ADMIN", "MEMBER"), connect);
clusterRouter.delete("/:clusterId", requireWorkspaceRole("ADMIN"), remove);