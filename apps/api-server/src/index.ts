import "dotenv/config";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import { authRouter } from "./routes/auth.routes.js";
import { alertPolicyRouter, topLevelAlertPolicyRouter } from "./routes/alert-policy.routes.js";
import { clusterRouter } from "./routes/cluster.routes.js";
import { incidentRouter, topLevelIncidentRouter } from "./routes/incident.routes.js";
import { workspaceRouter } from "./routes/workspace.routes.js";

const app: Express = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use(cookieParser());
app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/workspaces", workspaceRouter);
app.use("/api/v1/workspaces/:id/clusters", clusterRouter);
app.use("/api/v1/workspaces/:id/alert-policies", alertPolicyRouter);
app.use("/api/v1/alert-policies", topLevelAlertPolicyRouter);
app.use("/api/v1/workspaces/:id/incidents", incidentRouter);
app.use("/api/v1/incidents", topLevelIncidentRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
}

export default app;
