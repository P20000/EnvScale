# EnvScale Documentation Hub & Master Feature Index

> **Purpose:** Central navigation hub and modular documentation directory for **EnvScale** — a Multi-Tenant Kubernetes Observability & Gamified Governance Platform.
> **Design Principle:** Documentation is partitioned into focused, single-domain Markdown specifications under `docs/` so no single file becomes an unmaintainable monolith.

---

## 1. Modular Documentation Directory

### Core Architecture, Design & Algorithms
| Document | Scope & Technical Coverage |
| :--- | :--- |
| [System Architecture](system-architecture.md) | 4-tier platform block diagram, layer breakdown (`apps/web`, `apps/api-server`, `apps/k8s-streamer`, PostgreSQL/Redis), port matrix, and tenant isolation boundaries. |
| [Detailed Design (UML & ER)](detailed-design.md) | Entity-Relationship models, Go/TypeScript UML class diagrams, incident/log sequence diagrams, pod & cluster statecharts, and chaos engine deep dive. |
| [Core Algorithms & Math](algorithms.md) | Sugiyama/Dagre layout, hybrid drag persistence, FNV-1a deduplication, WebSocket frame coalescing, alert hysteresis, CHI scoring, and cryptography specs. |
| [DB & Auth Architecture](db-and-auth-architecture.md) | PostgreSQL Drizzle schemas, Better Auth OAuth (Google/GitHub), dual-token JWT lifecycle, SHA-256 refresh rotation, and AES-256-GCM vault. |
| [UI & UX Design System](design.md) | Material Design 3 dark surface tokens, anti-neon rule, floating capsule layout, custom React Flow node aesthetics, and typography rules. |

### Cluster Connectivity, Kubernetes Domains & Telemetry
| Document | Scope & Technical Coverage |
| :--- | :--- |
| [In-Cluster Agent & Onboarding](in-cluster-agent-and-onboarding.md) | Dual-mode onboarding wizard, dynamic `agent.yaml` RBAC manifest generator, outbound reverse-WebSocket agent runner, and direct Kubeconfig upload flow. |
| [Cluster Lifecycle & Resilience](cluster-lifecycle-and-resilience.md) | Startup cluster hydration, mutex-guarded recursive reconciliation worker, out-of-order cluster recovery, and frontend exponential backoff circuit breaker. |
| [Workloads, StatefulSets & Rollouts](k8s-workloads-and-rollouts.md) | Deployments, ReplicaSets, 1-click conflict-safe Rollback engine, StatefulSet control boards & headless DNS, DaemonSets, Jobs/CronJobs, static mirror pods, and probes. |
| [Storage & Volume Snapshots](storage-and-volume-snapshots.md) | PVC/PV/StorageClass informers, pod volume mount correlation, dynamic `snapshot.storage.k8s.io/v1` VolumeSnapshot informers, clone lineage, and Tier-3 vertical drop routing. |
| [Policies, Scaling, Quotas & RBAC](policies-autoscaling-and-quotas.md) | HPA v2 autoscaling telemetry, NetworkPolicies, PDBs with in-flight chaos safety guardrails, ResourceQuotas, LimitRanges, and in-cluster RBAC verb matrix. |
| [Logging, Metrics & Diagnostics](logging-metrics-and-diagnostics.md) | Universal multi-container `/ws/logs` multiplexer, stream health diagnostics panel, ANSI/JSON log parsing, run-length compression, and 1-second `/ws` metrics pulse. |

### Frontend, API Contracts, Operations & Governance
| Document | Scope & Technical Coverage |
| :--- | :--- |
| [Frontend Views & Interactions](frontend-views-and-interactions.md) | Scroll-scrubbed video landing page, app shell, multi-account switcher, custom node/edge catalog, physical node boundaries, Settings tabs, Incidents, Leaderboard, and M3 UI primitives. |
| [Frontend State & Store Architecture](frontend-state-and-store-architecture.md) | The 5 Zustand stores (`useTopologyStore`, `useAuthStore`, `useUIStore`, `useMetricsStore`, `useAlertStore`), 6 topology slices, and 16 domain helper reducers. |
| [API & WebSocket Reference](api-and-websocket-reference.md) | Complete endpoint catalog for `apps/api-server` and `apps/k8s-streamer`, RBAC/Zod schemas, JSON payload examples, HTTP error catalog, and `EVENT_*` contracts. |
| [Deployment Architecture](deployment.md) | As-built AWS Foundation (OIDC/S3/SSM), single-EC2 Compose + Caddy TLS runtime, digest releases, rollbacks, backups, and optional EKS cluster runbook. |
| [CI/CD Pipelines & Env Reference](cicd-and-environment-reference.md) | GitHub Actions (`ci.yml`, `cd.yml`, `foundation.yml`), release manifest & runtime guard scripts, SSM secret sync, and complete environment variable matrix. |
| [Developer Control Center & Tooling](developer-control-center-and-tooling.md) | Dual-mode `pnpm test-center` GTK4/Libadwaita GUI & Rich CLI, Python local/AWS/EKS orchestrators, `db-backup.sh`, and Git `pre-push` hook. |
| [Feature Matrix & Task Directory](features.md) | Canonical team task directory (`VIN-*`, `PRN-*`, `NEH-*`, `ISH-*`) and extended subsystem cross-references. |
| [Milestones & Roadmap](milestones.md) | 16-week engineering roadmap across Milestones 1–4. |
| [Feature Completion Matrix](notdoneyet.md) | Domain-by-domain tracking of completed vs. future Kubernetes abstractions. |

### Academic & Quality Assurance Artifacts
- [Software Requirements Specification (SRS)](EnvScale-SRS.md)
- [Semester 5 Final Project Report](EnvScale-Final-Project-Report.md)
- [QA Test Execution Matrix (`ISH-05`)](qa/ISH-05-QA-Test-Matrix.md) & [Bug Tracker](qa/ISH-05-Bug-Tracker.md)
- [Product Demo Video Production Pack (`ISH-09`)](demo/ISH-09-PRODUCTION-PLAN.md): [Feature Inventory](demo/ISH-09-FEATURE-INVENTORY.md), [Shot List](demo/ISH-09-SHOT-LIST.md), [Video Demo Script](demo/ISH-09-VIDEO-DEMO-SCRIPT.md)
- [Project Idea & Pitch](idea.md) & [Product Requirements Research](EnvScale%20PRD%20Research.md)
- [Git Branching Guide](GIT_GUIDE.md)

---

## 2. Complete Project Feature-to-Documentation Traceability Matrix

| Domain | Feature | Primary Source Implementation | Documentation Reference | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Auth & Security** | Better Auth OAuth, JWT & Refresh Token Rotation | [auth.ts](../apps/api-server/src/lib/auth.ts), [auth.service.ts](../apps/api-server/src/services/auth.service.ts) | [db-and-auth-architecture.md](db-and-auth-architecture.md) | Implemented |
| **Auth & Security** | Workspace RBAC (`ADMIN`, `MEMBER`, `VIEWER`) & Zod Guards | [auth.middleware.ts](../apps/api-server/src/middleware/auth.middleware.ts), [validate.ts](../apps/api-server/src/middleware/validate.ts) | [api-and-websocket-reference.md](api-and-websocket-reference.md) | Implemented |
| **Auth & Security** | AES-256-GCM Kubeconfig Vault | [crypto.ts](../apps/api-server/src/utils/crypto.ts), [crypto.go](../apps/k8s-streamer/pkg/crypto/crypto.go) | [algorithms.md](algorithms.md) | Implemented |
| **Connectivity** | Outbound In-Cluster Agent & Dynamic YAML Generator | [runner.go](../apps/k8s-streamer/pkg/agent/runner.go), [agent-manifest.service.ts](../apps/api-server/src/services/agent-manifest.service.ts) | [in-cluster-agent-and-onboarding.md](in-cluster-agent-and-onboarding.md) | Implemented |
| **Connectivity** | Dual-Mode Cluster Onboarding Wizard | [ConnectClusterWizard.tsx](../apps/web/src/components/onboarding/ConnectClusterWizard.tsx) | [in-cluster-agent-and-onboarding.md](in-cluster-agent-and-onboarding.md) | Implemented |
| **Connectivity** | Startup Hydration, Reconcile Worker & Circuit Breaker | [cluster-sync.service.ts](../apps/api-server/src/services/cluster-sync.service.ts), [cluster-reconcile.worker.ts](../apps/api-server/src/workers/cluster-reconcile.worker.ts) | [cluster-lifecycle-and-resilience.md](cluster-lifecycle-and-resilience.md) | Implemented |
| **Streaming** | `client-go` Informers, FNV-1a Dedup & WS Coalescing | [informer.go](../apps/k8s-streamer/pkg/k8s/informer.go), [dedup.go](../apps/k8s-streamer/pkg/k8s/dedup.go), [client.go](../apps/k8s-streamer/pkg/websocket/client.go) | [algorithms.md](algorithms.md) | Implemented |
| **Streaming** | Redis Pub/Sub Horizontal Fan-Out | [adapter.go](../apps/k8s-streamer/pkg/redis/adapter.go) | [algorithms.md](algorithms.md) | Implemented |
| **Compute** | Deployments, ReplicaSets & 1-Click Rollback Engine | [rollback_handler.go](../apps/k8s-streamer/pkg/server/rollback_handler.go), [ReplicasRevisionsSection.tsx](../apps/web/src/components/drawer/inspector/ReplicasRevisionsSection.tsx) | [k8s-workloads-and-rollouts.md](k8s-workloads-and-rollouts.md) | Implemented |
| **Compute** | StatefulSets Control Board & Headless DNS Directory | [statefulset_informer.go](../apps/k8s-streamer/pkg/k8s/statefulset_informer.go), [K8sStatefulSet.tsx](../apps/web/src/components/canvas/K8sStatefulSet.tsx) | [k8s-workloads-and-rollouts.md](k8s-workloads-and-rollouts.md) | Implemented |
| **Compute** | DaemonSets, Jobs, CronJobs & Completed Jobs Dock | [job_informer.go](../apps/k8s-streamer/pkg/k8s/job_informer.go), [K8sJob.tsx](../apps/web/src/components/canvas/K8sJob.tsx), [K8sCronJob.tsx](../apps/web/src/components/canvas/K8sCronJob.tsx) | [k8s-workloads-and-rollouts.md](k8s-workloads-and-rollouts.md) | Implemented |
| **Compute** | Static Mirror Pods & Container Health Probes | [informer_handlers.go](../apps/k8s-streamer/pkg/k8s/informer_handlers.go), [HealthProbesSection.tsx](../apps/web/src/components/drawer/inspector/HealthProbesSection.tsx) | [k8s-workloads-and-rollouts.md](k8s-workloads-and-rollouts.md) | Implemented |
| **Storage** | PVCs, PVs, StorageClasses & CSI VolumeSnapshots | [storage_informer.go](../apps/k8s-streamer/pkg/k8s/storage_informer.go), [snapshot_informer.go](../apps/k8s-streamer/pkg/k8s/snapshot_informer.go) | [storage-and-volume-snapshots.md](storage-and-volume-snapshots.md) | Implemented |
| **Config & Secrets** | Zero-Leak ConfigMap & Secret Metadata Informers | [config_informer.go](../apps/k8s-streamer/pkg/k8s/config_informer.go), [ConfigOverviewSection.tsx](../apps/web/src/components/drawer/inspector/ConfigOverviewSection.tsx) | [detailed-design.md](detailed-design.md) | Implemented |
| **Governance** | HPA, NetworkPolicies, PDBs, ResourceQuotas & LimitRanges | [policy_hpa_informer.go](../apps/k8s-streamer/pkg/k8s/policy_hpa_informer.go), [pdb_informer.go](../apps/k8s-streamer/pkg/k8s/pdb_informer.go), [quota_informer.go](../apps/k8s-streamer/pkg/k8s/quota_informer.go) | [policies-autoscaling-and-quotas.md](policies-autoscaling-and-quotas.md) | Implemented |
| **Governance** | In-Cluster RBAC Informer & Verb Permission Matrix | [rbac_informer.go](../apps/k8s-streamer/pkg/k8s/rbac_informer.go), [RBACAuthorizationSection.tsx](../apps/web/src/components/drawer/inspector/RBACAuthorizationSection.tsx) | [policies-autoscaling-and-quotas.md](policies-autoscaling-and-quotas.md) | Implemented |
| **Topology Canvas** | Dagre Multi-Tier Layout, 4-Cardinal Handles & Hybrid Drag | [layout.ts](../apps/web/src/utils/layout.ts), [useClusterLayoutPersistence.ts](../apps/web/src/hooks/useClusterLayoutPersistence.ts) | [algorithms.md](algorithms.md) | Implemented |
| **Topology Canvas** | Physical Node Boundary Containers & Multi-AZ Badges | [nodeBoundaryHelpers.ts](../apps/web/src/utils/nodeBoundaryHelpers.ts), [K8sNodeBoundary.tsx](../apps/web/src/components/canvas/K8sNodeBoundary.tsx) | [frontend-views-and-interactions.md](frontend-views-and-interactions.md) | Implemented |
| **Topology Canvas** | Undo/Redo Shortcuts & Physical Resource Deletion | [useKeyboardShortcuts.ts](../apps/web/src/hooks/useKeyboardShortcuts.ts), [routes_resource.go](../apps/k8s-streamer/pkg/server/routes_resource.go) | [frontend-views-and-interactions.md](frontend-views-and-interactions.md) | Implemented |
| **Logs & Metrics** | Universal Log Multiplexer, Logs View & Diagnostics Panel | [stream_logs_handler.go](../apps/k8s-streamer/pkg/server/stream_logs_handler.go), [LogsView.tsx](../apps/web/src/components/views/LogsView.tsx) | [logging-metrics-and-diagnostics.md](logging-metrics-and-diagnostics.md) | Implemented |
| **Logs & Metrics** | Continuous 1s Metrics Pulse & 60s Rolling Area Charts | [informer_metrics.go](../apps/k8s-streamer/pkg/k8s/informer_metrics.go), [MetricsView.tsx](../apps/web/src/components/views/MetricsView.tsx) | [logging-metrics-and-diagnostics.md](logging-metrics-and-diagnostics.md) | Implemented |
| **Chaos & Alerts** | Reversible Chaos Engine & PDB Safety Guardrails | [injector.go](../apps/k8s-streamer/pkg/chaos/injector.go), [safety.go](../apps/k8s-streamer/pkg/chaos/safety.go) | [detailed-design.md](detailed-design.md), [policies-autoscaling-and-quotas.md](policies-autoscaling-and-quotas.md) | Implemented |
| **Chaos & Alerts** | Alert Policies, CHI Health Index, Incidents & Leaderboard | [evaluator.go](../apps/k8s-streamer/pkg/k8s/evaluator.go), [health-calculator.service.ts](../apps/api-server/src/services/health-calculator.service.ts) | [algorithms.md](algorithms.md), [frontend-views-and-interactions.md](frontend-views-and-interactions.md) | Implemented |
| **UI & Settings** | Settings Suite, App Shell, Switcher, Nodes/Edges & Landing Page | [SettingsView.tsx](../apps/web/src/components/views/SettingsView.tsx), [TopologyCanvas.tsx](../apps/web/src/components/flow/TopologyCanvas.tsx), [LandingPage.tsx](../apps/web/src/components/landing/LandingPage.tsx) | [frontend-views-and-interactions.md](frontend-views-and-interactions.md) | Implemented |
| **Frontend State** | 5 Zustand Stores, 6 Topology Slices & 16 Domain Reducers | [useTopologyStore.ts](../apps/web/src/store/useTopologyStore.ts), [useAuthStore.ts](../apps/web/src/store/useAuthStore.ts) | [frontend-state-and-store-architecture.md](frontend-state-and-store-architecture.md) | Implemented |
| **CI/CD & Env** | GitHub Actions, Release Manifests, Runtime Guards & Env Matrix | [.github/workflows/](../.github/workflows), [deployment/scripts/](../deployment/scripts) | [cicd-and-environment-reference.md](cicd-and-environment-reference.md) | Implemented |
| **Dev Tooling** | `pnpm test-center` GTK4 GUI, Rich CLI, AWS/EKS CLI & DB Backup | [scripts/test-center](../scripts/test-center), [scripts/db-backup.sh](../scripts/db-backup.sh) | [developer-control-center-and-tooling.md](developer-control-center-and-tooling.md) | Implemented |
| **Cloud Infra** | Terraform EC2/EKS & Production Compose Release Stack | [deployment/](../deployment) | [deployment.md](deployment.md) | Implemented |

