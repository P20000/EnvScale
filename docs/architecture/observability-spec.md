# EnvScale — Authoritative Observability Specification

> **Status:** Authoritative Implementation Contract (Phases 3–4)  
> **Scope:** Kubernetes resource discovery coverage, unified log streaming, metrics collection & PostgreSQL retention, data freshness/failure diagnostics, and capability-aware UI behavior.

---

## 1. Kubernetes Resource Coverage & Restricted-RBAC Behavior

Every resource domain below is discovered through `ClusterExecutor` (`DirectExecutor` and `AgentExecutor` parity), probed via `SelfSubjectAccessReview` + API Discovery before starting informers, and surfaced with an explicit per-resource `CapabilityStatus`.

| Domain | API Group / Resource | Verbs | Availability Handling |
| :--- | :--- | :--- | :--- |
| **Cluster & Topology** | `core/v1`: `nodes`, `namespaces`, `pods`, `services`, `events` | `get`, `list`, `watch` | If cluster-scoped `nodes` is denied (namespace-scoped install), mark `nodes = permission_denied` and render pods grouped by namespace without node boundaries. Always include `namespaces` informer so empty namespaces are visible. |
| **Service Discovery** | `discovery.k8s.io/v1`: `endpointslices` (fallback `core/v1`: `endpoints`) | `get`, `list`, `watch` | Probes `discovery.k8s.io/v1` first; falls back to `core/v1/endpoints` on older clusters. |
| **Workloads** | `apps/v1`: `deployments`, `replicasets`, `statefulsets`, `daemonsets`; `batch/v1`: `jobs`, `cronjobs` | `get`, `list`, `watch` | Core workload topology; missing permissions mark individual kind `permission_denied` without blocking other informers. |
| **Networking** | `networking.k8s.io/v1`: `ingresses`, `networkpolicies` | `get`, `list`, `watch` | Graceful degradation if `networkpolicies` is forbidden. |
| **Config & Secrets** | `core/v1`: `configmaps`, `secrets` (metadata/key-names **only**) | `get`, `list`, `watch` | Secret data values are **never** serialized or transmitted. In Read-Only restricted profiles where `secrets` watch is disallowed, mark `secrets = permission_denied` cleanly. |
| **Storage** | `core/v1`: `persistentvolumeclaims`, `persistentvolumes`; optional `snapshot.storage.k8s.io/v1`: `volumesnapshots`, `volumesnapshotcontents` | `get`, `list`, `watch` | `PVs` may be `permission_denied` in namespace-scoped clusters; `snapshot.storage.k8s.io` is `cluster_unavailable` when CRD is absent. |
| **Policies & Quotas** | `autoscaling/v2`: `horizontalpodautoscalers`; `policy/v1`: `poddisruptionbudgets`; `core/v1`: `resourcequotas`, `limitranges` | `get`, `list`, `watch` | Probes API group/version first; on clusters lacking `policy/v1` or `autoscaling/v2`, reports `cluster_unavailable`. |
| **In-Cluster RBAC** | `core/v1`: `serviceaccounts`; `rbac.authorization.k8s.io/v1`: `roles`, `rolebindings`, `clusterroles`, `clusterrolebindings` | `get`, `list`, `watch` | Optional in Read-Only / namespace-scoped clusters; `ClusterRoles`/`ClusterRoleBindings` degrade cleanly to `permission_denied` when scoped to namespaces. |
| **Metrics** | `metrics.k8s.io/v1beta1`: `pods`, `nodes` | `get`, `list` | Reports `cluster_unavailable` if `metrics-server` API group is absent, `permission_denied` on 403. |

**Mandatory Sync Fix:** `InformerManager.GetSnapshot()` must never block on `WaitForCacheSync` for informers that were not started due to `permission_denied` or `cluster_unavailable`.

---

## 2. Log Streaming Behavior (Direct & Agent Parity)

- **Single Canonical Endpoint:** Browser connects exclusively to `WS /ws/logs` (aliases `/ws/stream/logs`, `/api/v1/stream/logs`) with `clusterId`, `namespace`, `kind`, `name`, optional `container`, and `tailLines`. Legacy `POST/DELETE /api/v1/logs/stream` (`pkg/k8s/logs.go` + `routes.go:275`) is **retired** because it leaks/cancels `r.Context()` and bypasses `ClusterExecutor`.
- **Shared Execution Engine:** `DirectExecutor` runs `LogStreamManager` (`stream_logs_manager.go`) directly; `AgentExecutor` triggers the identical `LogStreamManager` inside `envscale-agent` via `LOG_STREAM_START` / `LOG_STREAM_STOP` over `/ws/agent`.
- **Lifecycle & Error Parity:**
  - Supports multi-container workloads (`Deployment`, `StatefulSet`, `DaemonSet`, `Job`, `Pod`, `all`), `Service`/`Ingress`/`Node` event streaming, and container replacement/pod restart recovery with `SinceTime` deduplication.
  - Closing the browser WebSocket immediately cancels the stream context (`DirectExecutor`) or sends `LOG_STREAM_STOP` (`AgentExecutor`).
- **Required Visible Failure Taxonomy (`LogsView.tsx` & `useResourceLogs.ts`):**
  The UI **must** surface a distinct banner/empty-state reason for every non-streaming condition—a blank panel is never acceptable:
  1. `no_logs` — Container is running and stream is healthy, zero stdout/stderr lines emitted yet.
  2. `container_not_found` — Requested pod/container does not exist or terminated before stream start.
  3. `permission_denied` — Kubernetes RBAC denied `pods/list` or `pods/log` (`403 Forbidden`).
  4. `connection_interrupted` — Browser-to-streamer or streamer-to-agent WebSocket dropped (`reconnecting` state shown).
  5. `stream_terminated` — Container exited or pod was deleted during streaming.
  6. `cluster_unavailable` — Target cluster is `disconnected` or `waiting_for_agent`.
  7. `capability_unsupported` — Legacy `v1.0` agent connected without log streaming support.

---

## 3. Metrics Collection & Historical Retention

### 3.1 Normalized Sampling Pipeline

```text
Direct Metrics Poller / Agent METRICS_BATCH (15s bucketed UTC)
  └─► k8s-streamer normalizer (validates clusterId, non-negative values, real allocatable capacity)
        ├──► ws.Hub (EVENT_CLUSTER_METRICS live UI update)
        └──► api-server internal ingest (POST /api/v1/metrics/internal/ingest)
               └─► PostgreSQL `cluster_metric_samples` (idempotent ON CONFLICT DO NOTHING)
```

- **Sampling Interval:** Fixed **15 seconds** (replaces current 1-second polling in `informer_metrics.go` to reduce API server load across multi-cluster fleets).
- **Timestamp Normalization & Dedup:** Timestamps are floored to the 15s UTC bucket (`sampled_at`). `cluster_metric_samples` uses a composite unique constraint `(cluster_id, sampled_at)` so reconnect replays or duplicate deliveries are idempotent.
- **No Fake Capacities:** Never fall back to hardcoded `2000 mcores` / `4096 MiB` (`informer_metrics.go:161-166`) or `4.0 Cores` / `8.0 GB` (`MetricsView.tsx:237-238`). If node allocatable capacity is unknown (`permission_denied` on `nodes`), store `cpu_pct = NULL` / `mem_pct = NULL` and report raw millicores/MiB with explicit capacity-unavailable status.
- **Retention & Query Limits:**
  - Raw 15s samples retained for **7 days** (configurable `METRICS_RETENTION_DAYS`), pruned hourly by an `api-server` background worker. No new TSDB (Prometheus/InfluxDB) is introduced under Profile A.
  - Query API owned by `api-server`: `GET /api/v1/workspaces/:id/clusters/:clusterId/metrics/history?range=15m|1h|6h|24h|7d&limit=360`. Longer ranges (`6h`–`7d`) use SQL time-bucket averaging (`date_trunc` / epoch bucket) capped at `maxPoints = 360` to bound memory and payload size.
- **Missing-Data Handling:** Remove `createInitialHistory()` and `padHistory()` fake zero/flatline padding in `useMetricsStore.ts`. Time-series gaps render as explicit visual discontinuities with a `"No samples recorded during this window"` annotation.

---

## 4. Data Freshness & No-Fake-Data Rule

- **Freshness Envelope:** Snapshot and capability payloads carry `lastSyncAt` (UTC RFC3339), `connectionMode`, `connectionState`, and `staleAfterSec` (e.g. `120s` when heartbeat/resync lags).
- **Zero Synthetic Telemetry:** Remove all hardcoded fallbacks in `topologySnapshotHandler.ts` (`ip: "10.244.0.10"`, `cpuUsage: "20 mcores"`, `memoryUsage: "90 MiB"`, `ingressClassName: "nginx"`, `loadBalancerIps: ["127.0.0.1"]`, `port: ":8080"`). Missing fields render as `—` or `"Not reported"`.

---

## 5. Frontend Capability-Aware Behavior

A shared hook `useClusterCapabilities(clusterId)` fetches `GET /api/v1/clusters/:clusterId/capabilities` and listens for `EVENT_CAPABILITIES_UPDATED`:

| Capability State | Frontend UI Behavior |
| :--- | :--- |
| `supported_working` | Control/view enabled normally. |
| `permission_denied` | Control disabled or panel shows lock badge + exact missing Kubernetes verb/resource (e.g., `"Requires Operator Agent profile: deployments/scale patch"`). |
| `cluster_unavailable` | Panel displays explicit cluster-level absence (e.g., `"metrics-server API (metrics.k8s.io) is not installed on this cluster"`). |
| `temporarily_unavailable` | Banner indicates `reconnecting` / `disconnected` with `lastSyncAt` timestamp; mutating buttons disabled with retry status. |
| `not_implemented` | Action hidden or marked `"Coming soon / Deferred"` (e.g., OOM pressure chaos, or `v1.0` legacy agent upgrade prompt). |
