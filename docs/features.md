# EnvScale — Feature Matrix & Granular Task Directory

> **Document Purpose:** Comprehensive feature matrix and granular task breakdown for all team members. This document serves as the single source of truth for features, task IDs, and assignment logic synced with GitHub Issues & Project Board.

> [!NOTE]
> For detailed subsystem specifications covering all implemented features in the monorepo, browse the **[Modular Documentation Hub (`docs/README.md`)](README.md)**:
> [In-Cluster Agent & Onboarding](in-cluster-agent-and-onboarding.md) · [K8s Workloads & Rollouts](k8s-workloads-and-rollouts.md) · [Storage & VolumeSnapshots](storage-and-volume-snapshots.md) · [Policies, Autoscaling & Quotas](policies-autoscaling-and-quotas.md) · [Logging, Metrics & Diagnostics](logging-metrics-and-diagnostics.md) · [Frontend Views & Interactions](frontend-views-and-interactions.md) · [Frontend State Engine](frontend-state-and-store-architecture.md) · [API & WebSocket Reference](api-and-websocket-reference.md) · [CI/CD & Env Reference](cicd-and-environment-reference.md) · [Developer Control Center](developer-control-center-and-tooling.md) · [System Architecture](system-architecture.md) · [Detailed Design](detailed-design.md) · [Algorithms](algorithms.md) · [DB & Auth Architecture](db-and-auth-architecture.md) · [Cluster Lifecycle & Resilience](cluster-lifecycle-and-resilience.md)

---

## Team Task Ownership Matrix

| Team Member | Module Scope | Domain Responsibilities | Task Prefix |
| :--- | :--- | :--- | :--- |
| **Vinit** | `apps/api-server` | PostgreSQL, Drizzle ORM, REST API CRUD, JWT RBAC, Kubeconfig AES Vault, Health Index, Leaderboard Queries | `VIN-*` |
| **Pranav** | `apps/k8s-streamer` | Go/Node WebSocket Gateway, K8s Informers, `kubectl logs` Streamer, Redis Pub/Sub, Chaos Engine | `PRN-*` |
| **Neha** | `apps/web` | React Flow Visual Canvas, Zustand Store, Node/Pod Inspector, Alert Builder UI, Leaderboard UI | `NEH-*` |
| **Ishika** | `apps/web` & `docs/` | Onboarding Flow, UI Component Library, Toast/Error Boundaries, QA Matrix, IEEE SRS, Defense PPT | `ISH-*` |

---

## 1. Vinit — Backend CRUD & API Layer (`apps/api-server`)

### Phase 1: Database Initialization & Schema Architecture

#### [VIN-01] Docker Compose PostgreSQL & Redis Infrastructure
- **Description:** Provision local PostgreSQL 16 database and Redis 7 services via `docker-compose.dev.yml` with persistent volumes, health checks, and connection string environment variables.
- **Files:** `docker-compose.dev.yml`, `apps/api-server/.env.example`
- **Acceptance Criteria:** `docker compose up -d` boots PostgreSQL on `:5432` and Redis on `:6379` with health checks returning green.

#### [VIN-02] Drizzle ORM Schema Declarations
- **Description:** Define PostgreSQL database tables in `apps/api-server/src/db/schema.ts` using Drizzle ORM.
  - `users`: `id`, `email`, `password_hash`, `full_name`, `avatar_url`, `created_at`, `updated_at`
  - `workspaces`: `id`, `name`, `slug`, `owner_id`, `created_at`, `updated_at`
  - `workspace_members`: `workspace_id`, `user_id`, `role` (`ADMIN`, `MEMBER`, `VIEWER`), `joined_at`
  - `clusters`: `id`, `workspace_id`, `name`, `encrypted_kubeconfig`, `api_server_url`, `status`, `health_score`, `last_ping_at`
  - `alert_policies`: `id`, `workspace_id`, `name`, `metric_type`, `condition_operator`, `threshold_value`, `duration_seconds`, `severity`, `enabled`, `created_at`
  - `incidents`: `id`, `workspace_id`, `cluster_id`, `alert_policy_id`, `pod_name`, `namespace`, `status` (`TRIGGERED`, `ACKNOWLEDGED`, `RESOLVED`), `details`, `created_at`, `resolved_at`
  - `cluster_health_snapshots`: `id`, `cluster_id`, `score`, `active_pods`, `failing_pods`, `crash_streak_days`, `created_at`
- **Schema Note:** The implemented Drizzle schema under `apps/api-server/src/db/schema/` spans 12 tables (`users`, `refresh_tokens`, `sessions`, `accounts`, `verifications`, `jwks`, `workspaces`, `workspace_members`, `clusters`, `health_snapshots`, `alert_policies`, `incidents`) — see [`db-and-auth-architecture.md`](db-and-auth-architecture.md).
- **Files:** `apps/api-server/src/db/schema.ts`
- **Acceptance Criteria:** `drizzle-kit check` and `drizzle-kit generate` succeed without syntax or relation errors.

#### [VIN-03] Database Migration & Seeding Engine
- **Description:** Implement Drizzle migration execution scripts and database seed script to populate demo workspaces, sample RBAC roles, test alert policies, and mock cluster health snapshots.
- **Files:** `apps/api-server/src/db/migrate.ts`, `apps/api-server/src/db/seed.ts`
- **Acceptance Criteria:** Running `pnpm db:seed` inserts demo users, workspaces, clusters, and policies cleanly into PostgreSQL.

---

### Phase 2: Core REST API & Security Engine

#### [VIN-04] JWT Authentication & Password Hashing
- **Description:** Implement user registration, login, token refresh, and bcrypt password hashing REST API handlers.
- **Endpoints:**
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `GET /api/v1/auth/me`
- **Files:** `apps/api-server/src/controllers/auth.controller.ts`, `apps/api-server/src/services/auth.service.ts`
- **Acceptance Criteria:** Valid credentials return signed JWT access token (`7d` expiry) and HTTP-only refresh cookie (`7d`).

#### [VIN-05] Workspace CRUD & RBAC Authorization Middleware
- **Description:** Build REST endpoints for Workspace management and RBAC access control middleware (`ADMIN`, `MEMBER`, `VIEWER`).
- **Endpoints:**
  - `POST /api/v1/workspaces`
  - `GET /api/v1/workspaces`
  - `GET /api/v1/workspaces/:id`
  - `PUT /api/v1/workspaces/:id`
  - `DELETE /api/v1/workspaces/:id`
  - `POST /api/v1/workspaces/:id/members`
  - `DELETE /api/v1/workspaces/:id/members/:userId`
- **Files:** `apps/api-server/src/controllers/workspace.controller.ts`, `apps/api-server/src/middleware/rbac.ts`
- **Acceptance Criteria:** `VIEWER` role cannot modify workspace settings; `ADMIN` role can add/remove members.

#### [VIN-06] Kubeconfig AES-256-GCM Vault & Validation API
- **Description:** Implement server-side AES-256-GCM encryption/decryption utility for Kubeconfig secrets storage. Create cluster onboarding REST endpoint that validates target Kubernetes API connection before storing encrypted secret.
- **Endpoints:**
  - `POST /api/v1/workspaces/:id/clusters/connect`
  - `GET /api/v1/workspaces/:id/clusters`
  - `DELETE /api/v1/workspaces/:id/clusters/:clusterId`
- **Files:** `apps/api-server/src/utils/crypto.ts`, `apps/api-server/src/controllers/cluster.controller.ts`
- **Acceptance Criteria:** Kubeconfig file is encrypted before DB insert; raw secret is never logged or exposed in plaintext via API responses.

#### [VIN-06B] Cluster Lifecycle, Startup Hydration & Self-Healing Reconciler
- **Description:** Automatic cluster hydration on `api-server` boot, dynamic status updates (`connected` vs `disconnected`), and a recursive background reconciliation worker that auto-reconnects clusters started out-of-order or after service restarts. Includes frontend exponential backoff circuit breaking.
- **Documentation:** See full architectural spec in [docs/cluster-lifecycle-and-resilience.md](cluster-lifecycle-and-resilience.md).
- **Files:** `apps/api-server/src/services/cluster-sync.service.ts`, `apps/api-server/src/workers/cluster-reconcile.worker.ts`, `apps/web/src/hooks/useK8sStream.ts`
- **Acceptance Criteria:** Offline clusters connect automatically once started without requiring UI reload or re-uploading kubeconfig. Non-overlapping execution guaranteed via recursive timer. Clean teardown on `SIGINT`/`SIGTERM`.

#### [VIN-07] Zod API Payload Validation Middleware
- **Description:** Create central Zod validation middleware to validate request bodies, query params, and route parameters across all API endpoints.
- **Files:** `apps/api-server/src/middleware/validate.ts`, `apps/api-server/src/schemas/*.ts`
- **Acceptance Criteria:** Invalid API requests receive HTTP 400 with formatted Zod error messages listing invalid fields.

---

### Phase 3: Alerts, Incidents & Gamification API

#### [VIN-08] Alert Policy Management REST API
- **Description:** Implement REST endpoints for managing custom metric & status alert rules.
- **Endpoints:**
  - `POST /api/v1/workspaces/:id/alert-policies`
  - `GET /api/v1/workspaces/:id/alert-policies`
  - `PUT /api/v1/alert-policies/:id`
  - `DELETE /api/v1/alert-policies/:id`
  - `PATCH /api/v1/alert-policies/:id/toggle`
- **Files:** `apps/api-server/src/controllers/alert.controller.ts`
- **Acceptance Criteria:** Users can create CPU/Memory/Pod Crash alert rules with configurable thresholds.

#### [VIN-09] Incident Log Persistence & Resolution API
- **Description:** Implement Incident logging engine that records triggered cluster anomalies and exposes CRUD endpoints for incident lifecycle management.
- **Endpoints:**
  - `GET /api/v1/workspaces/:id/incidents`
  - `GET /api/v1/incidents/:id`
  - `PATCH /api/v1/incidents/:id/resolve`
  - `POST /api/v1/incidents/internal/trigger` (Internal API from streamer)
- **Files:** `apps/api-server/src/controllers/incident.controller.ts`, `apps/api-server/src/services/incident.service.ts`
- **Acceptance Criteria:** Incident logs record namespace, pod name, trigger timestamp, severity, and resolution timestamps.

#### [VIN-10] Dynamic Cluster Health Index Algorithm Backend
- **Description:** Develop Cluster Health Score algorithm ($0-100$) based on active pod ratios, crash loop penalties ($-\text{points per crash}$), OOMKilled events, and node status. Schedule background snapshot worker to write periodic scores to `cluster_health_snapshots`.
- **Files:** `apps/api-server/src/services/health-calculator.service.ts`, `apps/api-server/src/workers/snapshot.worker.ts`
- **Acceptance Criteria:** Health score drops proportionally during pod failures and restores automatically upon pod stabilization.

#### [VIN-11] Gamified Leaderboard & Governance Query Engine
- **Description:** Implement Leaderboard DB queries aggregating workspace health scores, crash-free streaks, and total incident resolution times.
- **Endpoints:**
  - `GET /api/v1/leaderboard`
  - `GET /api/v1/workspaces/:id/health-history`
- **Files:** `apps/api-server/src/controllers/leaderboard.controller.ts`
- **Acceptance Criteria:** Returns ranked workspaces with badges (e.g., "99.9% Uptime Club", "Zero Crash Streak", "Chaos Master").

---

### Phase 4: Optimization, Security Hardening & Benchmarking

#### [VIN-12] Database Query Optimization & Indexing
- **Description:** Add composite PostgreSQL indexes on high-frequency query paths (`incidents(workspace_id, status)`, `cluster_health_snapshots(cluster_id, created_at)`).
- **Files:** `apps/api-server/src/db/schema.ts`
- **Acceptance Criteria:** `EXPLAIN ANALYZE` on incident and health history queries show Index Scan execution under 10ms.

#### [VIN-13] k6 REST API Load Testing & Performance Benchmarks
- **Description:** Write k6 performance test scripts for API server endpoints under 1,000 requests/sec load.
- **Files:** `apps/api-server/tests/load/api-load-test.js`
- **Acceptance Criteria:** 95th percentile latency ($P_{95}$) is under 50ms for read endpoints.

#### [VIN-14] Automated Database Backup & Recovery Utility
- **Description:** Create backup script `scripts/db-backup.sh` for automated PostgreSQL `pg_dump` execution and restore validation.
- **Files:** `scripts/db-backup.sh`
- **Acceptance Criteria:** Backup script generates timestamped compressed dump file and restores cleanly to target database.

#### [VIN-15] Production Environment Audit & Security Scan
- **Description:** Perform security audit on CORS origin settings, rate-limiting middleware, JWT expiration rules, and environment variable schema validation.
- **Files:** `apps/api-server/src/config/env.ts`, `apps/api-server/src/middleware/rate-limit.ts`
- **Acceptance Criteria:** Express app enforces 100 req/min rate limit per IP and rejects invalid CORS origins.

---

## 2. Pranav — Architecture & Core Engine (`apps/k8s-streamer`)

- **[PRN-01]** Monorepo Infrastructure & Turbo Config (`pnpm-workspace.yaml`, `turbo.json`).
- **[PRN-02]** Go / Node.js WebSocket Streaming Server Architecture.
- **[PRN-03]** Kubernetes `client-go` Informer Factory (`PodInformer`, `NodeInformer`, `ServiceInformer`).
- **[PRN-04]** `kubectl logs -f` Real-time Pod Log Tailing Pipeline over WebSockets.
- **[PRN-05]** Redis Pub/Sub Adapter for Multi-Instance WebSocket State Sync.
- **[PRN-06]** Sub-200ms Pod Status Delta Event Emitter (`EVENT_POD_STATUS_CHANGED`).
- **[PRN-07]** Log Parsing Engine for Immediate `OOMKilled` & `ImagePullBackOff` Detection.
- **[PRN-08]** Chaos Engineering Fault Injection Engine (`apps/k8s-streamer/pkg/chaos`).
- **[PRN-09]** AWS EKS Cluster Provisioning & Helm Chart Deployment Manifests.
- **[PRN-10]** WebSocket 100+ Pod Load Stress Benchmarking Script.

---

## 3. Neha — Frontend UI & Visualization Engine (`apps/web`)

- **[NEH-01]** React + Vite + Tailwind CSS + shadcn/ui Application Shell & Token System.
- **[NEH-02]** Custom React Flow Node Components (`K8sGroup`, `K8sNode`, `K8sPod`, `K8sService`).
- **[NEH-03]** Dagre Auto-Layout Canvas Graph Engine with Nested Hybrid Topology (ArgoCD-style), Persistent User Drag Positioning (Hybrid Local Cache & PostgreSQL Backend Persistence), and Dynamic Edge Routing.
- **[NEH-04]** Real-Time Streaming Zustand Store (`useTopologyStore`).
- **[NEH-05]** `useK8sStream` Real-Time WebSocket Hook.
- **[NEH-06]** Pod Log Terminal Inspector Drawer Component.
- **[NEH-07]** Alert Policy Rule Builder Interface & Modal UI.
- **[NEH-08]** Gamified Leaderboard View Component with Rank Badges & Gauges.
- **[NEH-09]** Workspace Settings & Member RBAC Role Management Screens.
- **[NEH-10]** Canvas Rendering Performance Optimization (Node Memoization).

---

## 4. Ishika — UI Polish, Static Pages & QA (`apps/web` & `docs/`)

- **[ISH-01]** Step-by-Step "Connect Cluster" Onboarding Wizard UI with Material Design 3 flat, structured proportions and Dropzone.
- **[ISH-02]** Reusable UI Primitive Library (`Button`, `Modal`, `Badge`, `Card`, `Toast`).
- **[ISH-03]** Incident History Log View with Status Filters & Severity Badges.
- **[ISH-04]** Empty-State UI Components & Global Error Boundaries.
- **[ISH-05]** Black-Box QA Test Execution Matrix & Bug Tracker Log.
- **[ISH-06]** IEEE Format Software Requirements Specification (SRS) Document.
- **[ISH-07]** Semester 5 Engineering Project Final Report.
- **[ISH-08]** 15-Slide Presentation Deck (PPT) for Project Defense.
- **[ISH-09]** 3-Minute Product Video Demo Scripting & Editing.
- **[ISH-10]** Cross-Browser Visual QA Audit & Mobile Responsive Layout Fixes.

---

## 5. Extended Kubernetes Observability, In-Cluster Agent & Governance Subsystems

The following implemented platform capabilities extend the core PRN/VIN/NEH/ISH feature list and are documented in dedicated modular specs under [`docs/README.md`](README.md):

| Feature Group | Key Implemented Capabilities | Detailed Specification |
| :--- | :--- | :--- |
| **Dual-Mode In-Cluster Agent & Onboarding** | Outbound WebSocket `runner.go` agent mode (`connectionType: 'agent'`), `agent.yaml` generator, `AgentRegistry`, 365-day cluster-scoped HS256 JWT (`CLUSTER_TOKEN`), 2-mode Connect Cluster Wizard (`direct` / `agent`) | [`in-cluster-agent-and-onboarding.md`](in-cluster-agent-and-onboarding.md) |
| **Extended Workloads & Rollback Engine** | Conflict-safe 1-click Deployment Rollback (`rollback_handler.go`), StatefulSet ordinal blades & headless DNS directory, DaemonSets, Jobs/CronJobs/Completed Jobs badge, static mirror pod detection, liveness/readiness/startup probes | [`k8s-workloads-and-rollouts.md`](k8s-workloads-and-rollouts.md) |
| **Storage & CSI VolumeSnapshots** | `ExtractPodVolumeClaims`, PVC/PV/StorageClass informers, dynamic `snapshot.storage.k8s.io/v1` VolumeSnapshot & VolumeSnapshotContent informers, clone-parent lineage, Tier-3 vertical drop routing | [`storage-and-volume-snapshots.md`](storage-and-volume-snapshots.md) |
| **Autoscaling, Policies, Quotas & RBAC** | HPA v2 metric targets, NetworkPolicy ingress/egress visualization, PDB (`pdb_informer.go`) + Chaos Safety guardrails (`pkg/chaos/safety.go`), ResourceQuotas & LimitRanges, In-Cluster RBAC (`rbac_informer.go`) & 4-tier verb matrix | [`policies-autoscaling-and-quotas.md`](policies-autoscaling-and-quotas.md) |
| **Universal Log Multiplexer & Metrics Pulse** | Multi-container `/api/v1/stream/logs` & `/ws/logs` multiplexer (`LogStreamManager`), `LogDiagnosticsPanel`, ANSI/JSON log parsing & run-length compression, 1s `startMetricsPulse` & `MetricsView` 60s rolling charts | [`logging-metrics-and-diagnostics.md`](logging-metrics-and-diagnostics.md) |
| **Canvas Boundaries, Settings Suite & UX** | Physical `K8sNodeBoundary` host containers with AWS zone/instance labels, app shell & multi-account switcher, 13 custom React Flow node types + `K8sEdge`/`ArgoEdge`, keyboard undo/redo + physical deletion (`routes_resource.go`), 4 Settings tabs, Incident/Alert Rule Builder, Leaderboard, Landing Page, and M3 UI primitives | [`frontend-views-and-interactions.md`](frontend-views-and-interactions.md) |
| **Client-Side State Engine** | 5 Zustand stores (`useTopologyStore`, `useAuthStore`, `useUIStore`, `useMetricsStore`, `useAlertStore`), 6 topology slices (`topologyWsSlice`, `topologySnapshotHandler`, `topologyLayoutSlice`, etc.), and 16 domain reducers | [`frontend-state-and-store-architecture.md`](frontend-state-and-store-architecture.md) |
| **REST & WebSocket Protocol Contract** | Complete `api-server` & `k8s-streamer` HTTP route matrix, RBAC guards, Zod validation schemas, JSON payload examples, HTTP error catalog, `WSEventEnvelope`, and `ClusterSnapshot`/`EVENT_*` field specs | [`api-and-websocket-reference.md`](api-and-websocket-reference.md) |
| **CI/CD, Release Guards & Env Matrix** | GitHub Actions (`ci.yml`, `cd.yml`, `foundation.yml`), release manifest & runtime safety scripts (`deployment/scripts/`), SSM secret sync, and complete monorepo env variable contract | [`cicd-and-environment-reference.md`](cicd-and-environment-reference.md) |
| **Developer Control Center & Tooling** | Dual-mode `pnpm test-center` GTK4/Libadwaita desktop GUI & Rich CLI, Python local/K8s/chaos/AWS/EKS orchestrators (`scripts/lib/`), `db-backup.sh`, and Git `pre-push` hook | [`developer-control-center-and-tooling.md`](developer-control-center-and-tooling.md) |
