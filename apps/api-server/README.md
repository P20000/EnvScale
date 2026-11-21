# EnvScale REST API Server (`apps/api-server`)

Multi-tenant **Express 5 + TypeScript + Drizzle ORM + PostgreSQL 16** control-plane API server for **EnvScale** (default port `3000`).

---

## Core Responsibilities

- **Authentication & OAuth (`src/lib/auth.ts`, `src/services/auth.service.ts`):** Better Auth (`/api/auth/*`) supporting Google/GitHub OAuth and email/password alongside custom REST JWT auth (`/api/v1/auth/*`) issuing `7d` HS256 JWTs, SHA-256 hashed refresh cookies, multi-account session switching, and cluster-scoped streamer tokens.
- **Workspace Multi-Tenancy & RBAC (`src/middleware/auth.middleware.ts`):** Tenant isolation with `ADMIN`, `MEMBER`, and `VIEWER` guards and Zod request payload validation (`src/schemas/request.schemas.ts`).
- **AES-256-GCM Kubeconfig Vault & Agent Generator (`src/utils/crypto.ts`, `src/services/agent-manifest.service.ts`):** Encrypts `direct`-mode kubeconfig secrets at rest (`v1:<iv>:<tag>:<cipher>`) and dynamically generates least-privilege `envscale-agent` YAML manifests (`GET /api/v1/clusters/:clusterId/agent.yaml`).
- **Cluster Lifecycle & Self-Healing Reconciler (`src/services/cluster-sync.service.ts`, `src/workers/cluster-reconcile.worker.ts`):** Hydrates clusters on boot and runs a non-overlapping 20-second recursive reconciler syncing active clusters to `k8s-streamer`.
- **Alert Policies, Incidents, CHI & Leaderboard:** CRUD APIs for alert policies and incident resolution, background Cluster Health Index (CHI) snapshot worker (`src/workers/snapshot.worker.ts`), and workspace leaderboard rankings.

---

## Local Development & Scripts ([`package.json`](package.json))

```bash
# Configure environment
cp apps/api-server/.env.example apps/api-server/.env

# Apply Drizzle migrations & seed sample data
pnpm --filter envscale-api-server db:migrate
pnpm --filter envscale-api-server db:seed

# Start development server (:3000)
pnpm --filter envscale-api-server dev
```

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `dev` | `tsx watch src/index.ts` | Run API server with hot reload on `:3000` |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/index.js` | Run compiled production server |
| `type-check` | `tsc --noEmit` | Static TypeScript verification |
| `db:generate` | `drizzle-kit generate:pg` | Generate SQL migration from `src/db/schema/` |
| `db:migrate` | `tsx src/db/migrate.ts` | Apply tracked Drizzle migrations |
| `db:check` | `drizzle-kit check:pg` | Verify Drizzle schema consistency |
| `db:seed` | `tsx src/db/seed.ts` | Seed demo workspaces, users, and policies |
| `test:load` | `k6 run tests/load/api-load-test.js` | Execute k6 API load benchmark |

### Required Environment Variables ([`.env.example`](.env.example))
`PORT` (`3000`), `NODE_ENV`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (must match `k8s-streamer`), `JWT_REFRESH_SECRET`, `KUBECONFIG_ENCRYPTION_KEY` (32-byte Base64 for `direct` mode), `CORS_ORIGIN`, and optional `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`, `K8S_STREAMER_URL`, `STREAMER_WS_URL`, `LOCAL_STREAMER_WS_URL`, `AGENT_IMAGE`.

---

## Detailed Documentation

- [Complete REST API & WebSocket Reference](../../docs/api-and-websocket-reference.md)
- [Database Schema & Auth Architecture](../../docs/db-and-auth-architecture.md)
- [Cluster Lifecycle & Resilience](../../docs/cluster-lifecycle-and-resilience.md)
- [Core Algorithms & CHI Math](../../docs/algorithms.md)

