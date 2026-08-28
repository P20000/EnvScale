import "dotenv/config";
import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { env } from "./config/env.js";
import { standardLimiter, authLimiter } from "./middleware/rate-limit.js";
import { authRouter } from "./routes/auth.routes.js";
import { alertPolicyRouter, topLevelAlertPolicyRouter } from "./routes/alert-policy.routes.js";
import { alertRouter, topLevelAlertRouter } from "./routes/alert.routes.js";
import { clusterRouter } from "./routes/cluster.routes.js";
import { incidentRouter, topLevelIncidentRouter } from "./routes/incident.routes.js";
import { healthHistoryRouter, leaderboardRouter } from "./routes/leaderboard.routes.js";
import { workspaceRouter } from "./routes/workspace.routes.js";
import { startHealthSnapshotWorker } from "./workers/snapshot.worker.js";

const app: Express = express();
const port = env.PORT;

// ── Security Headers ────────────────────────────────────────────────────────
// Mount Helmet middleware to enforce security headers (X-Content-Type-Options,
// X-Frame-Options, X-XSS-Protection, etc.) configured for cross-origin CORS.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ── CORS Configuration ─────────────────────────────────────────────────────
// Uses CORS_ORIGIN from validated environment config instead of wildcard '*'.
// Supports comma-separated origins (e.g., "http://localhost:5173,https://app.envscale.dev")
const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ── Better Auth Handler ──────────────────────────────────────────────────
// Mount Better Auth handler BEFORE express.json() body parsing middleware
// to preserve raw incoming HTTP request streams for OAuth callbacks & forms.
app.use("/api/auth", toNodeHandler(auth));

app.use(express.json());
app.use(cookieParser());

// ── Rate Limiting ───────────────────────────────────────────────────────────
// Standard: 100 req/min per IP on all /api/v1/ routes
// Auth:     10 req/15min per IP on /api/v1/auth/login
app.use("/api/v1/", standardLimiter);
app.use("/api/v1/auth/login", authLimiter);

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/workspaces", workspaceRouter);
app.use("/api/v1/workspaces/:id/clusters", clusterRouter);
app.use("/api/v1/workspaces/:id/alert-policies", alertPolicyRouter);
app.use("/api/v1/alert-policies", topLevelAlertPolicyRouter);
app.use("/api/v1/workspaces/:id/alerts", alertRouter);
app.use("/api/v1/alerts", topLevelAlertRouter);
app.use("/api/v1/workspaces/:id/incidents", incidentRouter);
app.use("/api/v1/incidents", topLevelIncidentRouter);
app.use("/api/v1/leaderboard", leaderboardRouter);
app.use("/api/v1/workspaces/:id/health-history", healthHistoryRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
    console.log(`  Environment: ${env.NODE_ENV}`);
    console.log(`  CORS origins: ${env.CORS_ORIGIN}`);
    startHealthSnapshotWorker();
  });
}

export default app;

