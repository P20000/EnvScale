# EnvScale — Authoritative Architecture Specification

> **Status:** Authoritative Implementation Contract (Phases 1–7)  
> **Scope:** Control-plane boundaries, unified `ClusterExecutor` contract, `DirectExecutor` / `AgentExecutor` responsibilities, capability discovery, restricted-RBAC discovery, tenant isolation, and Profile A preservation.

---

## 1. System Layers & Control-Plane Ownership

EnvScale targets **Kubernetes API compatibility** across heterogeneous distributions (Minikube, Kind, K3s, EKS, AKS, GKE, OpenShift, self-managed Kubernetes) through one unified execution layer and two first-class transport adapters (`direct`, `agent`).

| Layer | Service / Module | Owns | Must Never Own |
| :--- | :--- | :--- | :--- |
| **Presentation** | `apps/web` (React, React Flow, Zustand) | Topology visualization, capability-aware controls, log/metric views, explicit degraded/error states | Direct K8s access, fabricated fallback telemetry, RBAC enforcement |
| **Control Plane & State** | `apps/api-server` (Express TS, Drizzle, PostgreSQL) | User auth (Better Auth + JWT), workspace/cluster RBAC (`ADMIN`/`MEMBER`/`VIEWER`), AES-256-GCM kubeconfig vault, durable state (`clusters`, `cluster_commands`, `cluster_metric_samples`, `chaos_experiments`, `agent_tokens`, `audit_logs`), mutation API entry points, streamer token minting | Long-lived K8s informers, WebSocket fan-out, raw WS log proxying |
| **Execution & Streaming** | `apps/k8s-streamer` (Go, `client-go`, Gorilla WS, Redis Pub/Sub) | `ClusterExecutorFactory`, `DirectExecutor` (`InformerManager`), `AgentExecutor` (`AgentRegistry` + `AgentSession`), `ws.Hub`, Redis Pub/Sub fan-out, log multiplexing, metric evaluation | Authoritative business state, direct PostgreSQL writes, unauthenticated cluster fallbacks |
| **In-Cluster Transport** | `envscale-agent` (`apps/k8s-streamer` `MODE=agent`) | Outbound authenticated `WSS /ws/agent`, in-cluster `SharedInformerFactory`, `LogStreamManager`, `metrics.k8s.io` polling, SSAR capability probing, bounded command execution | `cluster-admin` privileges, user session validation, multi-tenant awareness |

**Mutation & Persistence Boundary:** All mutating cluster operations (scaling, resource apply/delete, rollbacks, chaos inject/clear) enter through `apps/api-server` for workspace/cluster RBAC, Zod validation, audit logging, and durable command/experiment persistence, then dispatch to `apps/k8s-streamer` internal execution APIs. `apps/k8s-streamer` retains direct browser WebSockets (`/ws/k8s`, `/ws/logs`) and read-only snapshot hydration authenticated by `api-server`-minted tokens.

---

## 2. Unified `ClusterExecutor` Contract (`apps/k8s-streamer/pkg/executor`)

### 2.1 Core Types & Standardized Enums

```go
type ConnectionMode string // "direct" | "agent"

type ConnectionState string
const (
    StateConnected       ConnectionState = "connected"
    StateDegraded        ConnectionState = "degraded"        // connected with partial RBAC/API loss
    StateReconnecting    ConnectionState = "reconnecting"
    StateDisconnected    ConnectionState = "disconnected"
    StateWaitingForAgent ConnectionState = "waiting_for_agent"
)

type CapabilityState string
const (
    CapSupportedWorking       CapabilityState = "supported_working"
    CapPermissionDenied       CapabilityState = "permission_denied"
    CapClusterUnavailable     CapabilityState = "cluster_unavailable"
    CapTemporarilyUnavailable CapabilityState = "temporarily_unavailable"
    CapNotImplemented         CapabilityState = "not_implemented"
)

type CapabilityStatus struct {
    State     CapabilityState `json:"state"`
    Reason    string          `json:"reason,omitempty"`
    CheckedAt time.Time       `json:"checkedAt"`
    Details   map[string]any  `json:"details,omitempty"`
}

type ClusterCapabilities struct {
    ClusterID       string                      `json:"clusterId"`
    ConnectionMode  ConnectionMode              `json:"connectionMode"`
    ConnectionState ConnectionState             `json:"connectionState"`
    ProtocolVersion string                      `json:"protocolVersion,omitempty"`
    AgentVersion    string                      `json:"agentVersion,omitempty"`
    Capabilities    map[string]CapabilityStatus `json:"capabilities"`
    Resources       map[string]CapabilityStatus `json:"resources"` // e.g. "core/v1/pods", "apps/v1/deployments"
}
```

Standard capability keys: `topology`, `logs`, `metrics`, `events`, `resource_delete`, `resource_apply`, `deployment_scale`, `deployment_rollback`, `chaos_pod_crash`, `chaos_scale_down`, `pdb_validation` (`chaos_oom_pressure` explicitly reports `not_implemented` until deterministic recovery tests pass).

### 2.2 Standardized Error Taxonomy

| Sentinel / Error Code | HTTP Mapping | Meaning |
| :--- | :--- | :--- |
| `ErrClusterNotFound` | `404` | Cluster UUID is not registered in `ClusterExecutorFactory` |
| `ErrClusterDisconnected` | `503` | Cluster is `disconnected` or `waiting_for_agent` |
| `ErrCapabilityUnsupported` | `501` / `422` | Feature is `not_implemented` or `cluster_unavailable` |
| `ErrPermissionDenied` | `403` | Kubernetes RBAC (`SelfSubjectAccessReview` / 403) or workspace RBAC denied |
| `ErrCommandTimeout` | `504` | Executor/Agent did not respond within `timeoutMs` (state moves to `unknown_reconciling`) |
| `ErrCommandExpired` | `410` | Command `expiresAt` elapsed before execution began |
| `ErrPDBBlocked` | `409` | PodDisruptionBudget `disruptionsAllowed <= 0` without `force: true` |
| `ErrInvalidKubeconfig` | `422` | Forbidden `user.exec`, local file path, or invalid TLS/YAML |

### 2.3 `ClusterExecutor` Interface

```go
type ClusterExecutor interface {
    ClusterID() string
    Mode() ConnectionMode
    State(ctx context.Context) ConnectionState
    Capabilities(ctx context.Context) ClusterCapabilities
    GetSnapshot(ctx context.Context) (*types.ClusterSnapshot, error)
    CheckPDBSafety(ctx context.Context, req PDBCheckRequest) (*PDBCheckResult, error)
    StartLogStream(ctx context.Context, req LogStreamRequest, sink chan<- LogFrame) (StreamHandle, error)
    ExecuteOperation(ctx context.Context, cmd ClusterCommand) (*CommandResult, error)
    Close() error
}
```

---

## 3. `DirectExecutor`, `AgentExecutor` & `ClusterExecutorFactory`

- **`ClusterExecutorFactory`:** Resolves executors strictly by exact canonical `clusterID` (UUID v4). **Zero** single-cluster (`len == 1`) or dev-alias (`"minikube"`, `"default"`, `"local"`) fallbacks are permitted anywhere in `ClusterManager`, `InformerManager`, or `AgentRegistry`.
- **`DirectExecutor`:** Wraps a capability-gated `InformerManager`, `streamClientset` (`Timeout=0`), `metricsClient`, `dynamicClient`, and controlled auth adapter (from `security-and-compatibility-spec.md`). Executes logs via `LogStreamManager` and operations directly against Kubernetes `apps/v1`/`core/v1`/`networking/v1` APIs with conflict retry (`retry.RetryOnConflict`).
- **`AgentExecutor`:** Wraps an active `*AgentSession` in `AgentRegistry` keyed by `(clusterID, sessionID)`. Serves snapshots from the agent-synchronized store (including full delta updates), proxies `StartLogStream` over multiplexed `/ws/agent` channels, and dispatches `ExecuteOperation` via correlated `CMD_REQUEST`/`CMD_RESULT` frames.
- **Replacing Legacy Coupling:** Existing direct callers of `ClusterManager.GetClientset()` / `GetStreamClientset()` (`routes_resource.go`, `rollback_handler.go`, `stream_logs_handler.go`, `routes.go`, `chaos/injector.go`, `chaos/safety.go`) must be migrated incrementally to `ClusterExecutorFactory.GetExecutor(clusterID)`.

---

## 4. `ClusterCapabilityRegistry` & Restricted-RBAC Discovery

1. **Dynamic Probing (Never Hardcoded `true`):**
   - `DirectExecutor` probes Kubernetes `authorization.k8s.io/v1` `SelfSubjectAccessReview` (`SSAR`) and `Discovery().ServerGroups()` / `ServerResourcesForGroupVersion()` at registration and periodically on refresh.
   - `AgentExecutor` receives the Agent's live SSAR + API discovery probe in `AGENT_HELLO` and intersects it with `protocolVersion` and `permissionProfile` (`readonly` vs. `operator`).
   - Endpoint: `GET /api/v1/clusters/:clusterId/capabilities` (and WebSocket `EVENT_CAPABILITIES_UPDATED`).
2. **Eliminating the `WaitForCacheSync` 403 Deadlock:**
   - Today `InformerManager.GetSnapshot()` calls `im.factory.WaitForCacheSync(im.stopCh)` across all 25 registered informers (`pkg/k8s/informer_snapshot.go:32`), causing an infinite hang on any cluster lacking `list`/`watch` on any single resource (e.g., `ClusterRoles`, `PVs`, `ResourceQuotas`).
   - **Required Fix:** Probe `SSAR` (`list` + `watch`) and API group existence **before** registering each informer. Only start informers whose `CapabilityStatus` is `supported_working`, track per-informer `cache.InformerSynced` handles only for started informers with a bounded sync timeout, and record `permission_denied` or `cluster_unavailable` for skipped resources.
   - Support **namespace-scoped mode** when cluster-wide `list/watch` is denied: instantiate `informers.NewSharedInformerFactoryWithOptions(clientset, 30*time.Second, informers.WithNamespace(ns))` for each configured namespace.

---

## 5. Tenant Isolation & Authorization Boundaries

- **JWT & Claims Contract:**
  - `api-server` mints short-lived (15m) user streamer tokens (`tokenType: "user"`, `sub: userId`, `clusterRoles: { "<clusterUUID>": "ADMIN" | "MEMBER" | "VIEWER" }`).
  - Mutable cluster names are **never** embedded as authorization keys; no global `ADMIN` role bypasses workspace membership.
  - `k8s-streamer` (`pkg/websocket/auth.go`, `pkg/server/auth_middleware.go`) **fails closed**: missing `clusterRoles` or absent `clusterId` UUID returns `403 Forbidden`.
  - Agent tokens carry `tokenType: "agent"`, `clusterId`, and `tokenId` (verified against PostgreSQL `agent_tokens` or revocation cache) and are rejected on all user HTTP/WS endpoints.
- **PostgreSQL Ownership (`apps/api-server`):** Preserves all 12 canonical tables and adds versioned Drizzle migrations only as needed for `cluster_commands`, `cluster_metric_samples`, `chaos_experiments`, `agent_tokens`, and `audit_logs`.
- **Profile A Infrastructure Preservation:** Single-EC2 Docker Compose (`postgres`, `redis`, `api-server`, `k8s-streamer`, `web`) + host Caddy TLS + GitHub OIDC + SSM Parameter Store. No Prometheus, InfluxDB, or mandatory EKS runtime dependency.

---

## 6. Incremental Migration Rule

Do **not** refactor the entire repository in one pass:
1. Introduce `pkg/executor` interfaces, `ClusterExecutorFactory`, and `ClusterCapabilityRegistry`.
2. Migrate **one read-only workflow first** (`GetSnapshot` + `Capabilities` over `GET /api/v1/clusters/snapshot` and `GET /api/v1/clusters/:clusterId/capabilities`) and prove Direct & Agent parity on real clusters.
3. Incrementally migrate Logs, Metrics, Scaling/Resource Ops/Rollbacks, and Chaos in subsequent phases.
