# EnvScale

**Multi-Tenant Kubernetes Observability & Gamified Governance Platform**

EnvScale connects to local (`Minikube`, `K3s`) and cloud (`AWS EKS`) Kubernetes clusters—either inbound via encrypted `kubeconfig` secrets or outbound via an in-cluster reverse-tunnel agent—and streams live infrastructure telemetry over **WebSockets** (`client-go` informers + Redis Pub/Sub) into an interactive React Flow topology canvas with real-time log multiplexing, alert evaluation, reversible chaos testing, and 0–100 Cluster Health Index (CHI) leaderboards.

> **Documentation Hub:** Browse the complete modular specification suite at [`docs/README.md`](docs/README.md).

---

## Core Capabilities

- **Dual-Mode Cluster Connectivity:** Connect firewalled/private clusters outbound with the `envscale-agent` (`MODE=agent` over `/ws/agent`, generated via `agent.yaml`) or connect directly with AES-256-GCM encrypted `kubeconfig` credentials and a self-healing 20-second reconciliation loop.
- **Interactive Multi-Tier Topology Canvas:** `@xyflow/react` + Dagre layout organizing `Ingress`, `Service`, `Deployment`, `StatefulSet`, `ReplicaSet`, `DaemonSet`, `Job`/`CronJob`, `PVC`/`PV`/`VolumeSnapshot`, and physical `K8sNodeBoundary` host containers with persisted drag coordinates.
- **Real-Time Telemetry & Universal Log Multiplexer:** Sub-200ms `EVENT_*` state deltas over `/ws/k8s`, 1-second cluster CPU/RAM metrics pulse (`MetricsView`), and multi-container stdout/stderr tailing with ANSI/JSON parsing and stream diagnostics (`/ws/logs` & `/api/v1/stream/logs`).
- **Governance, Chaos & Conflict-Safe Rollouts:** Live visibility into `HPA`, `NetworkPolicy`, `PodDisruptionBudget` (with chaos safety guardrails), `ResourceQuota`/`LimitRange`, in-cluster RBAC verb matrices, 1-click Deployment rollback (`RetryOnConflict`), and reversible chaos fault injection (`crash`, `oom-pressure`, `scale-down`).
- **Multi-Tenant Auth, Incidents & Gamification:** Better Auth (Google/GitHub OAuth + email/password), `7d` HS256 JWTs + SHA-256 refresh token rotation, workspace RBAC (`ADMIN`, `MEMBER`, `VIEWER`), alert policy evaluation, and CHI leaderboards.

---

## Monorepo Layout & Tech Stack

| Path | Role | Primary Stack | Details |
| :--- | :--- | :--- | :--- |
| [`apps/web`](apps/web/README.md) | Visual topology UI, drawers, logs, metrics, settings | React 19, Vite 8, TypeScript, Tailwind CSS, `@xyflow/react`, Zustand | [Frontend README](apps/web/README.md) |
| [`apps/api-server`](apps/api-server/README.md) | Multi-tenant REST API, Better Auth, AES-256 vault, CHI | Express 5, TypeScript, Drizzle ORM, PostgreSQL 16, Zod | [API Server README](apps/api-server/README.md) |
| [`apps/k8s-streamer`](apps/k8s-streamer/README.md) | Real-time K8s informer gateway, chaos engine, agent runner | Go 1.24, `k8s.io/client-go v0.30.2`, Gorilla WebSocket, Redis 7 | [Streamer README](apps/k8s-streamer/README.md) |
| [`packages/types`](packages/types/src/index.ts) | Shared TypeScript types & WebSocket event constants | TypeScript | — |
| [`packages/tsconfig`](packages/tsconfig/base.json) | Shared base/Node/React TypeScript configurations | TypeScript | — |
| [`deployment`](deployment/README.md) | AWS Foundation, EC2/EKS Terraform, Prod Compose, Caddy, SSM | Terraform, Docker Compose, Caddy, Python 3, Bash | [Deployment README](deployment/README.md) |
| [`scripts`](docs/developer-control-center-and-tooling.md) | `test-center` GTK4/Rich CLI launcher, DB backup, git hooks | Python 3.12 (GTK4/Libadwaita, Click, Rich), Bash | [Tooling Guide](docs/developer-control-center-and-tooling.md) |
| [`testing`](testing) | Sample K8s manifests, demo app, & deployment contract tests | Kubernetes YAML, Node.js, Python `unittest` | — |
| [`docs`](docs/README.md) | Architecture, API/WS specs, algorithms, runbooks, QA & SRS | Markdown + Mermaid | [Docs Hub](docs/README.md) |

---

## Local Quickstart

### Prerequisites
- **Node.js** `>= 18` (`20+` recommended) and **pnpm** `10.0.0`
- **Go** `1.24+` (for `apps/k8s-streamer`)
- **Docker & Docker Compose v2** (for PostgreSQL 16 & Redis 7 via [`docker-compose.dev.yml`](docker-compose.dev.yml))
- **Kubernetes cluster** (`Minikube`, `K3s`, or remote cluster + `kubectl`) for live cluster streaming
- **Python 3.12+** *(optional, for `pnpm test-center` GUI/CLI orchestrator)*

### Option 1: Control Center Launcher (`pnpm test-center`)

```bash
pnpm install
pnpm test-center        # Launches GTK4/Libadwaita GUI (or Rich CLI fallback)
# Or run headlessly via CLI:
./envscale.sh start --all
```

### Option 2: Manual Monorepo Startup

1. **Install workspace dependencies & configure environment files:**
   ```bash
   pnpm install
   cp apps/api-server/.env.example apps/api-server/.env
   cp apps/k8s-streamer/.env.example apps/k8s-streamer/.env
   cp apps/web/.env.example apps/web/.env
   ```
   Ensure `JWT_ACCESS_SECRET` matches across `apps/api-server/.env` and `apps/k8s-streamer/.env`.

2. **Start PostgreSQL 16 & Redis 7, run Drizzle migrations, and seed demo data:**
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   pnpm --filter envscale-api-server db:migrate
   pnpm --filter envscale-api-server db:seed
   ```

3. **Start all services:**
   ```bash
   # Terminal 1: API Server (:3000) & Web UI (:5173)
   pnpm dev

   # Terminal 2: Go Kubernetes Streaming Gateway (:8080)
   cd apps/k8s-streamer && go run ./cmd/server/main.go
   ```

### Local Service Ports

| Service | Default Port | Endpoint |
| :--- | :--- | :--- |
| **Web UI (`apps/web`)** | `5173` | `http://localhost:5173` |
| **API Server (`apps/api-server`)** | `3000` | `http://localhost:3000/health` |
| **K8s Streamer (`apps/k8s-streamer`)** | `8080` | `http://localhost:8080/healthz`, `ws://localhost:8080/ws/k8s` |
| **PostgreSQL 16** | `5432` | `postgresql://envscale:envscale_password@localhost:5432/envscale` |
| **Redis 7** | `6379` | `redis://localhost:6379` |

---

## Testing, Verification & Benchmarks

- **Monorepo TypeScript Build & Lint:**
  ```bash
  pnpm build
  pnpm lint
  pnpm --filter envscale-api-server db:check
  ```
- **Go Gateway Unit & Race Tests:**
  ```bash
  cd apps/k8s-streamer && go test -v -race ./...
  ```
- **Deployment & IAM Contract Tests:**
  ```bash
  python3 deployment/scripts/validate-release-manifest.py --manifest deployment/release/release-manifest.example.json --allow-example
  python3 -m unittest discover -s testing/deployment -p "test_*.py" -v
  ```
- **k6 REST API Load Benchmark:**
  ```bash
  pnpm --filter envscale-api-server test:load   # runs apps/api-server/tests/load/api-load-test.js
  ```
- **Kubernetes Sample & Stress Manifests:**
  - Multi-resource benchmark stack: [`testing/k8s/`](testing/k8s) (15 manifests) + [`testing/app/`](testing/app) (or `pnpm test-center --cli k8s deploy`)
  - Fault-injection & high-density fixtures: [`test-fault-injection.yaml`](test-fault-injection.yaml) and [`test-high-density-topology.yaml`](test-high-density-topology.yaml)

---

## Key Documentation

- [Documentation Hub & Traceability Matrix](docs/README.md)
- [System Architecture](docs/system-architecture.md) & [Detailed Design (UML & ER)](docs/detailed-design.md)
- [REST API & WebSocket Event Reference](docs/api-and-websocket-reference.md)
- [Database & Auth Architecture](docs/db-and-auth-architecture.md)
- [Production & Cloud Deployment Runbook](docs/deployment.md)
- [CI/CD Pipelines & Env Reference](docs/cicd-and-environment-reference.md)
- [Team Git & Branching Guide](docs/GIT_GUIDE.md)
