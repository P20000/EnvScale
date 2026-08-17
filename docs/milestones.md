# EnvScale — Production Implementation Milestones & Technical Roadmap

**Project Name:** EnvScale — Multi-Tenant Kubernetes Observability & Gamified Governance Platform  
**Target Architecture:** Microservices Observability, Real-Time Topology Visualizer, Gamified Health Engine  
**Project Timeline:** 16 Weeks (Semester 5 Engineering Project)  
**Document Owner:** Principal Cloud Architect & DevOps Lead  

---

## Technical Overview & Monorepo Architecture

EnvScale is engineered as an enterprise-grade monorepo containing decoupled services designed for sub-second Kubernetes state synchronization, multi-tenant workspace governance, metric alerting, and cluster stability scoring.

```text
EnvScale Monorepo Structure
├── apps/
│   ├── web/                    # React + Vite + Tailwind + React Flow (Frontend)
│   │   ├── src/
│   │   │   ├── components/     # Topology Canvas, Inspector, Alert Builder, Leaderboard
│   │   │   ├── hooks/          # useK8sStream, useAuth, useWorkspace
│   │   │   ├── store/          # Zustand Global Topology & Alert State Store
│   │   │   └── pages/          # Onboarding, Workspace, Alert Rules, Analytics
│   │   └── package.json
│   │
│   ├── k8s-streamer/           # Go / Node.js Streaming Gateway (WebSocket + K8s Informers)
│   │   ├── pkg/
│   │   │   ├── k8s/            # client-go Informer / Watch API handlers & Log Streamer
│   │   │   ├── websocket/      # Gorilla WebSocket Hub & Client Connections
│   │   │   └── redis/          # Pub/Sub Event Bus Adapter
│   │   ├── cmd/server/main.go
│   │   └── package.json / go.mod
│   │
│   └── api-server/             # Node.js Express / Go REST API Service (CRUD & Auth)
│       ├── src/
│       │   ├── controllers/    # Workspaces, RBAC, Alert Policies, Incidents, Leaderboard
│       │   ├── db/             # Drizzle ORM Schemas, Migrations, Connection Pool
│       │   ├── middleware/     # JWT Auth, Workspace Access Guard, Encryption Helpers
│       │   └── services/       # Health Scoring Algorithm & Incident Aggregator
│       └── package.json
│
├── packages/                   # Shared Monorepo Packages
│   ├── tsconfig/               # Shared TypeScript configurations
│   ├── eslint-config/          # Shared ESLint linting rules
│   └── types/                  # Shared TypeScript / Protobuf contracts
│
└── docs/                       # Architectural Docs, SRS, Manuals & Milestones
```

---

## Monorepo Responsibility Matrix

| Team Member | Core Focus & Domain | Primary Responsibilities |
| :--- | :--- | :--- |
| **Pranav** | **Architecture & Core Engine** | Monorepo setup, `k8s-streamer` Go/Node gateway, Kubernetes Client API integration (`client-go`), live log-tailing pipeline, and chaos fault injection engine. |
| **Vinit** | **Backend CRUD & API Layer** | PostgreSQL database initialization, Drizzle ORM schema design, REST endpoints (Workspaces, RBAC, Alerts, Incidents), AES-256 credential management, and Leaderboard DB logic. |
| **Neha** | **Frontend UI & Visualization** | React Flow dynamic topology canvas, animated graph edges, node status badge renderers, live metric inspector drawer, and Alert Policy rule builder UI. |
| **Ishika** | **UI Polish, Static Pages & QA** | Step-by-step "Connect Cluster" onboarding wizard, empty state components, black-box QA testing matrices, IEEE format SRS/Project Report, PPT deck, and demo video. |

---

## Milestone 1: Monorepo Setup, DB Schema & Local K8s Environment (Weeks 1–3)

### Objectives & Focus Areas
- Establish a production-ready monorepo workspace using pnpm workspaces and Turborepo.
- Containerize and bootstrap local Kubernetes development environments (Minikube / K3s).
- Design and execute relational database migrations using PostgreSQL and Drizzle ORM for workspace multi-tenancy, RBAC, encrypted Kubeconfigs, alert policies, and incident tracking.
- Bootstrap shared TypeScript type definitions and base UI component libraries.

### Technical Deliverables & Sub-modules

```
+-------------------------------------------------------------------------+
|                        Milestone 1 Architecture                         |
|                                                                         |
|  +--------------------+    +--------------------+    +---------------+  |
|  |   Local Minikube   |    |    PostgreSQL      |    | Redis Pub/Sub |  |
|  |  (K3s Cluster Dev) |    |  (Drizzle Schema)  |    |  (Event Bus)  |  |
|  +---------+----------+    +---------+----------+    +-------+-------+  |
|            |                         |                       |          |
|            +-------------------------+-----------------------+          |
|                                      |                                  |
|                          +-----------v-----------+                      |
|                          | Monorepo Environment  |                      |
|                          | (Turborepo + pnpm)    |                      |
|                          +-----------------------+                      |
+-------------------------------------------------------------------------+
```

#### 1. Monorepo Base Setup (`/`)
- Configure `pnpm-workspace.yaml` and `turbo.json` with pipeline caching for `build`, `lint`, `dev`, and `typecheck`.
- Set up root ESLint, Prettier, and TypeScript base configurations across all sub-apps (`apps/web`, `apps/api-server`, `apps/k8s-streamer`).

#### 2. Relational Database Schema & Drizzle ORM (`apps/api-server/src/db`)
- Define Drizzle PostgreSQL schema tables:
  - `users`: User identity, password hash (bcrypt), system role (`SUPER_ADMIN`, `USER`).
  - `workspaces`: Tenant organization boundaries, slug, owner ID.
  - `workspace_members`: Junction table mapping users to workspaces with RBAC roles (`ADMIN`, `MEMBER`, `VIEWER`).
  - `kubeconfigs`: Workspace-level cluster credentials, encrypted payload (`iv`, `authTag`, `encryptedData`), cluster context, control plane endpoint.
  - `alert_policies`: User-defined rules (`metric_type`, `threshold`, `duration_seconds`, `severity`, `workspace_id`).
  - `incidents`: Persisted alert triggers (`policy_id`, `pod_name`, `namespace`, `status` (`TRIGGERED`, `RESOLVED`), `triggered_at`, `resolved_at`).
  - `cluster_health_snapshots`: Hourly aggregated stability score snapshots (0–100) per workspace.

#### 3. Kubernetes Development Cluster & Cryptography Foundations (`apps/k8s-streamer`)
- Set up local Minikube / K3s cluster deployment scripts with custom multi-namespace microservices (Frontend, Auth, Payment, Inventory) for realistic topology testing.
- Implement AES-256-GCM encryption/decryption module for storing and loading `Kubeconfig` raw YAML blobs safely.

#### 4. Frontend Workspace Shell (`apps/web`)
- Initialize Vite + React + TypeScript + Tailwind CSS + shadcn/ui application shell.
- Install React Flow (`@xyflow/react`), Lucide Icons (`lucide-react`), and Zustand.
- Implement global Dark Mode design system with custom CSS variables and shadcn/ui component styles.

---

### Task Allocations per Team Member

#### Pranav (Architecture & Core System Engine)
- [x] Configure monorepo build pipeline (`pnpm`, `turbo.json`, `tsconfig.base.json`).
- [x] Write automated local Kubernetes setup scripts (`scripts/bootstrap-k8s.sh`) to spin up Minikube with multi-namespace sample workloads.
- [x] Implement AES-256-GCM Kubeconfig vault helper (`apps/k8s-streamer/pkg/crypto/encrypt.go` or TS equivalent).
- [x] Set up base `client-go` connection factory to parse Kubeconfig structs into dynamic Kubernetes REST clients.

#### Vinit (Backend CRUD & API Layer)
- [x] Provision PostgreSQL database instance via Docker Compose (`docker-compose.dev.yml`).
- [x] Write Drizzle ORM schema declarations (`apps/api-server/src/db/schema.ts`).
- [x] Execute initial Drizzle migrations (`drizzle-kit generate` & `drizzle-kit push`).
- [x] Write seed script (`apps/api-server/src/db/seed.ts`) populating demo workspaces, RBAC roles, and test users.

#### Neha (Frontend UI & Visualization Engine)
- [x] Initialize `apps/web` with Vite, React, TypeScript, Tailwind CSS, and shadcn/ui.
- [x] Configure design system tokens in `tailwind.config.js` and shadcn/ui theme configuration (custom neon color accents, dark palette `#0f172a`).
- [x] Set up React Flow canvas wrapper component with basic zoom/pan handlers.
- [x] Create Zustand global store skeleton (`apps/web/src/store/useTopologyStore.ts`).

#### Ishika (UI Polish, Static Pages & Quality Assurance)
- [x] Design layout wireframes for the "Connect Cluster" onboarding flow.
- [x] Build reusable UI primitives: `Button`, `Modal`, `Input`, `Badge`, `Card`, `Spinner`.
- [x] Initialize repository documentation structure (`docs/`) and update `README.md`.
- [x] Create QA test tracking sheet for Milestone 1 sanity checks.

---

### Verification & Acceptance Criteria
- [ ] Monorepo commands `pnpm build` and `pnpm lint` pass cleanly without circular dependencies.
- [ ] Docker Compose boots PostgreSQL and Redis containers with health checks passing.
- [ ] Drizzle ORM migrations run successfully; tables (`users`, `workspaces`, `workspace_members`, `kubeconfigs`, `alert_policies`, `incidents`, `cluster_health_snapshots`) exist in PostgreSQL.
- [ ] Local Minikube/K3s cluster is running with sample microservices deployed in namespace `demo-app`.
- [ ] AES-256-GCM module correctly encrypts raw `Kubeconfig` content into ciphertext and decrypts back to identical byte strings.

---

## Milestone 2: Kubernetes API Streaming Engine & Core CRUD APIs (Weeks 4–7)

### Objectives & Focus Areas
- Construct a high-concurrency Go/Node.js WebSocket streaming gateway using Kubernetes Informers for real-time cluster event detection.
- Implement REST API endpoints for Workspaces, RBAC user management, and encrypted Kubeconfig management.
- Establish sub-second metric and status streaming between the Kubernetes control plane, Redis event bus, and React frontend.
- Build the step-by-step "Connect Cluster" onboarding workflow with Kubeconfig file parsing and validation.

### Technical Deliverables & Sub-modules

```text
+----------------------------------------------------------------------------------+
|                            Milestone 2 Streaming Architecture                    |
|                                                                                  |
|  +--------------------+         +-----------------------+                        |
|  |  K8s Control Plane |         |    k8s-streamer       |                        |
|  |  (Informer/Watch)  |=======> |  (Gorilla WebSocket Hub)                        |
|  +--------------------+         +-----------+-----------+                        |
|                                             |                                    |
|                                   WebSocket Stream (JSON)                        |
|                                             v                                    |
|  +--------------------+         +-----------------------+                        |
|  |   api-server REST  | <=====> |    React Frontend     |                        |
|  |   (Workspace CRUD) |         |  (useK8sStream Hook)  |                        |
|  +--------------------+         +-----------------------+                        |
+----------------------------------------------------------------------------------+
```

#### 1. Real-Time K8s Streaming Gateway (`apps/k8s-streamer`)
- **Informer Pipeline:** Implement Kubernetes `SharedInformerFactory` targeting `Pods`, `Nodes`, and `Services`.
- **Event Transformer:** Parse Informer delta events (`AddFunc`, `UpdateFunc`, `DeleteFunc`) into normalized EnvScale JSON event payloads (`EVENT_NODE_MUTATED`, `EVENT_POD_STATUS_CHANGED`).
- **WebSocket Gateway:** Build WebSocket hub handling client subscriptions keyed by `workspace_id`.
- **Log Tailing Engine:** Construct streaming log handler wrapping Kubernetes `CoreV1().Pods(ns).GetLogs(...)` to pipe live stdout/stderr streams to client WebSockets.

#### 2. REST API Engine (`apps/api-server/src/controllers`)
- **Auth & RBAC Middleware:** JWT authentication guard and Workspace Permission Enforcer middleware checking user roles (`ADMIN`, `MEMBER`, `VIEWER`).
- **Workspace Controllers:**
  - `POST /api/v1/workspaces`: Create workspace.
  - `GET /api/v1/workspaces`: List user workspaces.
  - `POST /api/v1/workspaces/:id/members`: Add user with RBAC role.
  - `DELETE /api/v1/workspaces/:id/members/:userId`: Remove user.
- **Kubeconfig Vault Controllers:**
  - `POST /api/v1/workspaces/:id/kubeconfig`: Upload, validate, and store encrypted cluster credentials.
  - `GET /api/v1/workspaces/:id/cluster-status`: Test cluster reachability via Kubernetes `/healthz` check.

#### 3. Frontend Real-Time Hydration (`apps/web/src/hooks`)
- Develop custom React hook `useK8sStream(workspaceId)` handling automatic WebSocket connection, reconnection exponential backoff, and state store dispatch.
- Create Pod Log Viewer drawer component displaying live streaming terminal output with search and autoscroll controls.

#### 4. Onboarding Workflow (`apps/web/src/pages/onboarding`)
- Implement step-by-step wizard:
  1. Workspace Creation -> 2. Drag & Drop Kubeconfig Upload -> 3. Automated Cluster Connectivity Test -> 4. Initial Topology Canvas Setup.

---

### Task Allocations per Team Member

#### Pranav (Architecture & Core System Engine)
- [ ] Build Kubernetes Informer pipeline (`apps/k8s-streamer/pkg/k8s/informers.go`) for Pods, Nodes, and Services.
- [ ] Implement WebSocket server hub (`apps/k8s-streamer/pkg/websocket/hub.go`) supporting room-based subscriptions by workspace ID.
- [ ] Build live log streaming pipe (`apps/k8s-streamer/pkg/k8s/logs.go`) delivering `kubectl logs -f` lines over WebSockets.
- [ ] Integrate Redis Pub/Sub adapter to sync event deltas across scaled `k8s-streamer` gateway instances.

#### Vinit (Backend CRUD & API Layer)
- [ ] Implement REST endpoints for Workspace CRUD and member management (`apps/api-server/src/controllers/workspace.controller.ts`).
- [ ] Write JWT authentication and RBAC authorization middleware (`apps/api-server/src/middleware/rbac.ts`).
- [ ] Create Kubeconfig upload endpoint with server-side validation against target Kubernetes API server (`POST /api/v1/workspaces/:id/kubeconfig`).
- [ ] Implement Zod validation schemas for all incoming API request payloads.

#### Neha (Frontend UI & Visualization Engine)
- [ ] Implement `useK8sStream` hook to synchronize WebSocket delta messages into Zustand store.
- [ ] Build Pod Log Terminal Inspector drawer component with live line tailing, auto-scroll, and log level filtering (INFO, WARN, ERROR).
- [ ] Bind real-time pod state changes (Running -> Red CrashLoopBackOff) to topology node visualization properties.
- [ ] Build Workspace Settings & Member Management UI pages.

#### Ishika (UI Polish, Static Pages & Quality Assurance)
- [ ] Implement step-by-step "Connect Cluster" onboarding flow UI with drag-and-drop file dropzone.
- [ ] Build empty-state components for workspaces without clusters connected or missing pod deployments.
- [ ] Integrate global Toast notification system for connection errors and API failures.
- [ ] Author Draft IEEE SRS Document (Sections 1 & 2: Introduction and Overall Description).

---

### Verification & Acceptance Criteria
- [ ] WebSocket streaming gateway broadcasts cluster events (`Pod` phase changes, node readiness) to connected frontend clients within < 200ms.
- [ ] REST API prevents non-authenticated or unauthorized requests based on workspace RBAC roles.
- [ ] Uploading a valid `Kubeconfig` via onboarding UI validates connectivity against Kubernetes `/healthz` and stores encrypted record in DB.
- [ ] Invalid `Kubeconfig` files fail gracefully with explicit user-facing error messages in the onboarding wizard.
- [ ] Pod log drawer streams live container stdout/stderr output over WebSocket without blocking the UI main thread.

---

## Milestone 3: Interactive Topology Canvas, Alert Policies & Gamification Engine (Weeks 8–11)

### Objectives & Focus Areas
- Deliver an interactive React Flow visual topology canvas mapping Nodes, Pods, and Services with auto-layout positioning.
- Implement custom alert policy CRUD operations and metric evaluation engine.
- Build persistent Incident Logging with severity tagging and resolution lifecycle tracking.
- Compute dynamic Cluster Health Index (0–100) and render Uptime & Efficiency Leaderboards.

### Technical Deliverables & Sub-modules

```text
+-----------------------------------------------------------------------------------+
|                           Milestone 3 Core Workflow                               |
|                                                                                   |
|  +--------------------+     +------------------------+     +-------------------+  |
|  |  React Flow Canvas | <== | K8s Streamer & Metrics | ==> | Alert Rule Engine |  |
|  |  (Node/Pod Graph)  |     | (CPU, Mem, Restarts)   |     | (Worker Evaluation|  |
|  +--------------------+     +------------------------+     +---------+---------+  |
|                                                                      |            |
|                                                                      v            |
|  +--------------------+     +------------------------+     +-------------------+  |
|  | Leaderboard View   | <== | Cluster Health Engine  | <== | Incident History  |  |
|  | (Rankings 0-100)   |     | (0-100 Health Scoring) |     | (Postgres Persistence) |
|  +--------------------+     +------------------------+     +-------------------+  |
+-----------------------------------------------------------------------------------+
```

#### 1. Interactive Cluster Topology Canvas (`apps/web/src/components/canvas`)
- **Custom React Flow Nodes:**
  - `K8sNode`: Renders Kubernetes worker/control plane nodes with CPU/Memory gauge bars.
  - `K8sPod`: Displays pod status badge (Green=Running, Red=CrashLoop, Yellow=Pending), restart count badge, and resource metrics.
  - `K8sService`: Visualizes ingress routing and service-to-pod edge links.
- **Auto-Layout Engine:** Integrate Dagre layout algorithm for automatic hierarchical placement of Nodes -> Services -> Pods.
- **Interactive Controls:** Node selection sidebar, zoom-to-fit, mini-map renderer, and layout toggle (Horizontal vs. Vertical).

#### 2. Custom Alert Policy & Incident Engine (`apps/api-server` & `apps/k8s-streamer`)
- **Alert Policy REST APIs:**
  - `POST /api/v1/alert-policies`: Create metric rule (e.g., `PodRestarts > 3 in 5m`, `CPU > 85%`).
  - `GET /api/v1/alert-policies`: List active workspace policies.
  - `PUT /api/v1/alert-policies/:id`: Modify policy threshold/severity.
  - `DELETE /api/v1/alert-policies/:id`: Remove alert rule.
- **Metric Evaluator Engine:** Background daemon in Go/Node evaluating live pod metrics against stored workspace alert policies every 10 seconds.
- **Incident Logger:** Automatically write triggered alerts to `incidents` table with state `TRIGGERED`. Auto-resolve to `RESOLVED` when metrics stabilize.

#### 3. Gamified Health Scoring & Leaderboard (`apps/api-server/src/services`)
- **Cluster Health Score Algorithm (0–100):**
  $$\text{Health Index} = 100 - \left( (\text{CrashLoop Pods} \times 15) + (\text{High Memory Pods} \times 5) + (\text{Unready Nodes} \times 25) \right)$$
  *(Bounded within $0 \le \text{Index} \le 100$)*.
- **Leaderboard API:** `GET /api/v1/leaderboard`: Ranks workspaces by average 7-day health index, longest zero-crash streak, and resource efficiency score.

---

### Task Allocations per Team Member

#### Pranav (Architecture & Core System Engine)
- [ ] Build background Metric Evaluator worker engine evaluating live streaming metrics against alert rule thresholds.
- [ ] Implement log string parser inside `k8s-streamer` to catch `OOMKilled` and `ImagePullBackOff` panic events immediately.
- [ ] Create cluster fault injection utility (`apps/k8s-streamer/pkg/chaos`) to artificially trigger pod crash loops, high CPU usage, and pod restarts for testing.
- [ ] Optimize WebSocket binary/JSON payload sizes for large clusters (50+ pods).

#### Vinit (Backend CRUD & API Layer)
- [ ] Build Custom Alert Policy CRUD REST APIs (`apps/api-server/src/controllers/alert.controller.ts`).
- [ ] Build Incident history persistence endpoints and resolution tracking (`GET /api/v1/incidents`, `PATCH /api/v1/incidents/:id/resolve`).
- [ ] Implement Cluster Health Index calculation logic and periodic score background snapshot worker.
- [ ] Implement Leaderboard query aggregation APIs with workspace ranking calculations.

#### Neha (Frontend UI & Visualization Engine)
- [ ] Build custom React Flow node components (`K8sNodeComponent`, `K8sPodComponent`, `K8sServiceComponent`).
- [ ] Integrate Dagre graph auto-layout algorithm for dynamic canvas rendering.
- [ ] Build Alert Rule Configuration modal UI and rule builder interface.
- [ ] Build Leaderboard visual view with rank badges, streak indicators, and health score gauges.

#### Ishika (UI Polish, Static Pages & Quality Assurance)
- [ ] Design and build Incident History log UI view with status filters (`TRIGGERED`, `RESOLVED`) and severity badges (`CRITICAL`, `WARNING`).
- [ ] Create empty state UI graphics for empty incident lists and unconfigured alert rules.
- [ ] Complete IEEE SRS Document Sections 3 & 4 (Specific Requirements and System Features).
- [ ] Author execution test suite for Canvas drag-and-drop responsiveness and alert firing latency.

---

### Verification & Acceptance Criteria
- [ ] React Flow canvas renders Nodes, Pods, and Services with correct status colors and auto-arranges layout seamlessly.
- [ ] Triggering a pod crash via fault injection triggers a custom alert within 10 seconds and logs an entry in `incidents` table.
- [ ] Cluster Health Score dynamically recalculates down from 100 when pod failures occur, and recovers when pods stabilize.
- [ ] Leaderboard API correctly ranks workspace environments based on health score snapshots and crash-free streaks.
- [ ] Node inspector panel opens on click, showing real-time CPU/memory usage gauges and streaming log tailing.

---

## Milestone 4: Chaos Testing, Quality Assurance, Documentation & Defense Prep (Weeks 12–16)

### Objectives & Focus Areas
- Deploy target environments to cloud infrastructure (AWS EKS) alongside local Minikube testing.
- Perform rigorous chaos testing, security auditing, and load testing (100+ concurrent WebSocket updates).
- Polish visual interface, fix layout quirks, optimize database queries, and harden security.
- Finalize all academic deliverables: IEEE SRS, Final Project Report, Presentation Deck (PPT), and Product Video Demo.

### Technical Deliverables & Sub-modules

```text
+----------------------------------------------------------------------------------+
|                            Milestone 4 Cloud & Defense                           |
|                                                                                  |
|  +--------------------+         +------------------------+                       |
|  | Local K3s/Minikube |         |        AWS EKS         |                       |
|  | (Development Env)  |         | (Production Cloud Env) |                       |
|  +---------+----------+         +-----------+------------+                       |
|            |                                |                                    |
|            +-------------------+------------+                                    |
|                                |                                                 |
|                     +----------v-----------+                                     |
|                     | EnvScale Monorepo    |                                     |
|                     | (EKS Deployment)     |                                     |
|                     +----------+-----------+                                     |
|                                |                                                 |
|       +------------------------+------------------------+                        |
|       |                        |                        |                        |
|  +----v---------------+  +-----v--------------+  +------v---------------+        |
|  | Black-Box QA Logs  |  | IEEE SRS & Report  |  | PPT Deck & Video     |        |
|  | & Load Test Report |  | (Academic Defense) |  | (Product Demo)       |        |
|  +--------------------+  +--------------------+  +----------------------+        |
+----------------------------------------------------------------------------------+
```

#### 1. AWS EKS Infrastructure & Cloud Deployment (`infra/`)
- Provision AWS EKS cluster with managed node groups.
- Deploy EnvScale services (`api-server`, `k8s-streamer`, `web`) using Helm charts or Kubernetes manifests.
- Configure Ingress Controllers, TLS certificates (Cert-Manager), and secure Redis/PostgreSQL instances.

#### 2. Chaos Engineering & Security Hardening
- Execute automated fault injection scenarios:
  - Pod OOMKilled simulation.
  - Node NotReady state injection.
  - Network latency & API server disconnect simulation.
- Audit AES-256 Kubeconfig encryption storage, JWT secret expiration, and rate-limiting middleware.

#### 3. Academic & Presentation Artifacts (`docs/`)
- IEEE Format Software Requirements Specification (SRS).
- Complete Project Report detailing system architecture, DB schema, performance benchmarks, and user guide.
- 15-Slide Presentation Deck (PPT) for Semester 5 Defense.
- High-definition 3-minute video demonstration highlighting real-time canvas, alert triggering, log tailing, and gamified leaderboard.

---

### Task Allocations per Team Member

#### Pranav (Architecture & Core System Engine)
- [ ] Provision AWS EKS target cluster and configure cloud service deployment manifests.
- [ ] Conduct end-to-end load testing of `k8s-streamer` WebSocket connection gateway under simulated stress (100+ pod updates/sec using k6/custom scripts).
- [ ] Perform chaos injection validation on EKS, proving real-time topology updates during node and pod crashes.
- [ ] Implement production security hardening (TLS termination, Redis password auth, WebSocket rate limiting).

#### Vinit (Backend CRUD & API Layer)
- [ ] Optimize PostgreSQL database queries with proper indexes on `incidents(workspace_id, status)` and `cluster_health_snapshots(workspace_id, created_at)`.
- [ ] Conduct k6 load testing on REST API endpoints (`/api/v1/workspaces`, `/api/v1/alert-policies`).
- [ ] Build automated database backup and restore utility scripts.
- [ ] Finalize environment variable schemas and security config audits.

#### Neha (Frontend UI & Visualization Engine)
- [ ] Perform visual polish across all screens: micro-animations, shadcn/ui component consistency, smooth transitions.
- [ ] Optimize React Flow canvas rendering performance (memoization of custom nodes, virtualized graph rendering for large clusters).
- [ ] Resolve cross-browser visual bugs and mobile/tablet viewport responsiveness issues.
- [ ] Implement global error boundary components and fallback visual states.

#### Ishika (UI Polish, Static Pages & Quality Assurance)
- [ ] Execute complete black-box test suite and compile formal QA Bug Matrix & Verification Log.
- [ ] Author and format final IEEE SRS and Semester 5 Project Report PDF.
- [ ] Create high-impact Slide Presentation Deck (PPT) for project defense.
- [ ] Script, record, and edit the 3-minute product demo video demonstrating key features.

---

### Verification & Acceptance Criteria
- [ ] EnvScale successfully connects to both local Minikube/K3s and remote AWS EKS clusters.
- [ ] WebSocket streaming gateway handles 100+ concurrent state updates per second with < 5% CPU overhead on gateway service.
- [ ] All black-box QA tests pass with zero critical or high-severity open bugs in the issue tracker.
- [ ] IEEE format SRS and Project Report documents are fully written, reviewed, and formatted in `docs/`.
- [ ] Project PPT deck and 3-minute video demo are finalized and ready for Semester 5 project defense evaluation.

---

## Complete 16-Week Gantt Chart Schedule

```text
Week  | Phase Focus                        | Lead Assigned
------+------------------------------------+-------------------------------------------
W01   | Monorepo Setup & Tooling          | Pranav
W02   | DB Schema & Drizzle ORM Setup      | Vinit
W03   | UI Shell & K8s Local Cluster       | Neha & Pranav
W04   | K8s Informer Gateway (Go)          | Pranav
W05   | REST APIs for Workspaces & RBAC    | Vinit
W06   | WebSocket Client & Onboarding UI   | Neha & Ishika
W07   | Live Log Tailing & Cipher Vault    | Pranav & Vinit
W08   | React Flow Canvas Custom Nodes    | Neha
W09   | Alert Policy Engine & Evaluator    | Pranav & Vinit
W10   | Health Scoring & Incident Logging  | Vinit & Neha
W11   | Gamified Leaderboard & Empty States| Vinit, Neha & Ishika
W12   | AWS EKS Infrastructure Setup       | Pranav
W13   | Chaos Testing & Fault Injection    | Pranav & Vinit
W14   | QA Black-Box Testing & UI Polish   | Neha & Ishika
W15   | IEEE SRS & Project Report Writing  | Ishika
W16   | Defense Prep, PPT & Demo Video     | All Team Members (Led by Ishika)
```
