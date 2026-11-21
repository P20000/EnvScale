# Complete REST API & WebSocket Event Reference

> **Document Scope:** Authoritative endpoint catalog for `apps/api-server` (Express + TypeScript) and `apps/k8s-streamer` (Go + Gorilla WebSocket), RBAC guards, Zod validation schemas, concrete request/response payloads, WebSocket `EVENT_*` contracts, and HTTP error catalog.
> **Primary Modules:** [`apps/api-server/src/routes/`](../apps/api-server/src/routes), [`apps/api-server/src/schemas/request.schemas.ts`](../apps/api-server/src/schemas/request.schemas.ts), [`apps/k8s-streamer/pkg/server/routes.go`](../apps/k8s-streamer/pkg/server/routes.go), [`apps/k8s-streamer/pkg/types/events.go`](../apps/k8s-streamer/pkg/types/events.go)

---

## 1. REST API Server Endpoints (`apps/api-server`, Default Port `3000`)

Global protections in [`apps/api-server/src/index.ts`](../apps/api-server/src/index.ts): Helmet security headers, strict `CORS_ORIGIN` allowlist (`NODE_ENV=production` rejects `*`), `standardLimiter` (`100 req/min` per IP on `/api/v1/`), and `authLimiter` (`10 req/15min` per IP on `/api/v1/auth/login`).

### Health, Better Auth & Custom Auth ([`auth.routes.ts`](../apps/api-server/src/routes/auth.routes.ts))
| Method | Path | Auth / Role Guard | Validation Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health`, `/api/health`, `/api/v1/health` | Public | — | Liveness check (`{"status":"ok"}`). |
| `ALL` | `/api/auth/*` | Better Auth | — | OAuth (Google/GitHub) & Better Auth session endpoints. |
| `POST` | `/api/v1/auth/register` | Public | `registerSchema` | Creates user, default workspace, access JWT (`7d`), and refresh cookie (`7d`). |
| `POST` | `/api/v1/auth/login` | Public (`authLimiter`) | `credentialsSchema` | Verifies bcrypt password and issues access JWT (`7d`) + refresh cookie (`7d`). |
| `POST` | `/api/v1/auth/refresh` | Cookie (`refreshToken`) | — | Rotates SHA-256 refresh token and issues new access JWT (`7d`). |
| `POST` | `/api/v1/auth/switch-session` | Account Switch | `{ accountId \| email }` | Switches active browser session and issues `7d` HS256 JWT with scoped `allowedClusterIds`. |
| `GET` | `/api/v1/auth/me` | `requireAuth` | — | Returns current user and default workspace. |
| `GET` | `/api/v1/auth/streamer-token` | `requireAuth` | — | Issues `7d` HS256 JWT embedding `allowedClusterIds` for `k8s-streamer`. |

### Workspaces & Members ([`workspace.routes.ts`](../apps/api-server/src/routes/workspace.routes.ts))
| Method | Path | Auth / Role Guard | Validation Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workspaces` | `requireAuth` | — | Lists all workspaces accessible to the caller with role. |
| `POST` | `/api/v1/workspaces` | `requireAuth` | `workspaceSchema` | Creates workspace (`slug` auto-generated if omitted); creator becomes `ADMIN`. |
| `GET` | `/api/v1/workspaces/:id` | `ADMIN`, `MEMBER`, `VIEWER` | `workspaceParamsSchema` | Fetches workspace details and member list. |
| `PUT` | `/api/v1/workspaces/:id` | `ADMIN` | `updateWorkspaceSchema` | Updates workspace name, slug, or description. |
| `DELETE` | `/api/v1/workspaces/:id` | `ADMIN` | `workspaceParamsSchema` | Deletes workspace (`204 No Content`). |
| `POST` | `/api/v1/workspaces/:id/members` | `ADMIN` | `memberSchema` | Adds user with role (`ADMIN` \| `MEMBER` \| `VIEWER`). |
| `DELETE` | `/api/v1/workspaces/:id/members/:userId` | `ADMIN` | `memberParamsSchema` | Removes member (prevents self-removal). |

### Clusters, Agent Manifests & Layout Persistence ([`cluster.routes.ts`](../apps/api-server/src/routes/cluster.routes.ts))
All workspace-scoped paths under `/api/v1/workspaces/:id/clusters` also have top-level aliases under `/api/v1/clusters` resolving the caller's default workspace (`GET /api/v1/clusters`, `POST /api/v1/clusters`, `POST /api/v1/clusters/connect`, `DELETE /api/v1/clusters/:clusterId`, `GET /api/v1/clusters/:clusterId/agent.yaml`, and `GET`/`PUT`/`DELETE /api/v1/clusters/:clusterId/layout`):
| Method | Path | Auth / Role Guard | Validation Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workspaces/:id/clusters` | `ADMIN`, `MEMBER`, `VIEWER` | `workspaceParamsSchema` | Lists workspace clusters (excludes encrypted `kubeconfig`). |
| `POST` | `/api/v1/workspaces/:id/clusters/connect` | `ADMIN`, `MEMBER` | `clusterConnectSchema` | Registers cluster (`direct` encrypts kubeconfig via AES-256-GCM; `agent` initializes `waiting_for_agent`). |
| `DELETE` | `/api/v1/workspaces/:id/clusters/:clusterId` | `ADMIN` | `clusterParamsSchema` | Deletes cluster record (`204 No Content`). |
| `GET` | `/api/v1/clusters/:clusterId/agent.yaml` | `requireAuth` | `clusterId` (+ `?serverUrl=`) | Generates multi-document `envscale-agent` RBAC & Deployment YAML. |
| `GET` | `/api/v1/clusters/:clusterId/layout` | `requireAuth` | `clusterLayoutParamSchema` | Retrieves persisted React Flow node positions (`userLayouts[userId]`). |
| `PUT` | `/api/v1/clusters/:clusterId/layout` | `requireAuth` | `clusterLayoutSchema` | Saves `{ positions: Record<string, {x, y}> }` to PostgreSQL. |
| `DELETE` | `/api/v1/clusters/:clusterId/layout` | `requireAuth` | `clusterLayoutParamSchema` | Resets user's persisted node coordinates. |

### Alert Policies, Incidents & Governance ([`alert-policy.routes.ts`](../apps/api-server/src/routes/alert-policy.routes.ts), [`incident.routes.ts`](../apps/api-server/src/routes/incident.routes.ts), [`leaderboard.routes.ts`](../apps/api-server/src/routes/leaderboard.routes.ts))
*(Note: `/api/v1/workspaces/:id/alerts` and `/api/v1/alerts` alias the alert policy routers.)*
| Method | Path | Auth / Role Guard | Validation Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/workspaces/:id/alert-policies` | `ADMIN`, `MEMBER`, `VIEWER` | `workspaceParamsSchema` | Lists workspace alert policies. |
| `POST` | `/api/v1/workspaces/:id/alert-policies` | `ADMIN`, `MEMBER` | `alertPolicySchema` | Creates alert policy (`CPU` \| `MEMORY` \| `POD_RESTART`). |
| `GET` | `/api/v1/alert-policies/:policyId` | `requireAlertPolicyRole` (All) | `alertPolicyParamsSchema` | Fetches single alert policy. |
| `PUT` | `/api/v1/alert-policies/:policyId` | `requireAlertPolicyRole` (`ADMIN`, `MEMBER`) | `updateAlertPolicySchema` | Updates policy threshold, operator, duration, or severity. |
| `PATCH` | `/api/v1/alert-policies/:policyId/toggle` | `requireAlertPolicyRole` (`ADMIN`, `MEMBER`) | `alertPolicyToggleSchema` | Enables/disables policy (`{ isEnabled }`). |
| `DELETE` | `/api/v1/alert-policies/:policyId` | `requireAlertPolicyRole` (`ADMIN`) | `alertPolicyParamsSchema` | Deletes alert policy (`204`). |
| `GET` | `/api/v1/workspaces/:id/incidents` | `ADMIN`, `MEMBER`, `VIEWER` | `workspaceParamsSchema` | Lists incidents for workspace. |
| `GET` | `/api/v1/incidents` | `requireAuth` | — | Lists all incidents accessible to the user. |
| `POST` | `/api/v1/incidents/internal/trigger` | `requireAuth` | — | Internal trigger endpoint called by `k8s-streamer` metric evaluator. |
| `PATCH` | `/api/v1/incidents/:incidentId/resolve` | `requireIncidentRole` (`ADMIN`, `MEMBER`) | `incidentResolveSchema` | Marks incident resolved with optional `resolution` notes. |
| `GET` | `/api/v1/leaderboard` | `requireAuth` | — | Returns ranked workspace leaderboard with streaks and badges. |
| `GET` | `/api/v1/workspaces/:id/health-history` | `ADMIN`, `MEMBER`, `VIEWER` | `healthHistoryQuerySchema` | Queries historical `health_snapshots` (`days` 1–90, default `7`). |

---

## 2. Kubernetes Streaming Gateway Endpoints (`apps/k8s-streamer`, Port `8080`)

Defined across [`routes.go`](../apps/k8s-streamer/pkg/server/routes.go), [`routes_chaos.go`](../apps/k8s-streamer/pkg/server/routes_chaos.go), [`routes_resource.go`](../apps/k8s-streamer/pkg/server/routes_resource.go), [`rollback_handler.go`](../apps/k8s-streamer/pkg/server/rollback_handler.go), and [`auth_middleware.go`](../apps/k8s-streamer/pkg/server/auth_middleware.go):

| Protocol / Method | Path | Auth Guard | Purpose |
| :--- | :--- | :--- | :--- |
| `GET` | `/healthz` | Public | Returns active clients, clusters, log streams, chaos ops, alert rules, and Redis status. |
| `WS` | `/ws/k8s` | JWT (`AuthenticateHandshake`) | Real-time cluster room subscription (`?clusterId=&clientId=&token=`). |
| `WS` | `/ws/agent` | JWT (`AuthenticateRequest`) | Inbound reverse-tunnel connection from `envscale-agent` pods. |
| `WS` | `/ws/logs`, `/ws/stream/logs`, `/api/v1/stream/logs` | `AuthenticateHandshake` + `CheckClusterAuthorization` | Universal multi-container log & resource event multiplexer (`?clusterId=&namespace=&kind=&name=&tailLines=`). |
| `POST` | `/api/v1/clusters/register` | `RequireAdmin` (`ADMIN` / `api-server`) | Registers cluster via `kubeconfig` (raw/base64) or `isInClusterMode`. |
| `GET` | `/api/v1/clusters/snapshot` | `RequireClusterAuth` | Returns 25 cluster resource arrays plus `metricsHistory` (does not include `volumeSnapshots`/`volumeSnapshotContents`, which stream via live WS deltas). |
| `GET` | `/api/v1/clusters/metrics/history` | `RequireClusterAuth` | Returns 60-second rolling `ClusterMetricPoint[]` history. |
| `GET` | `/api/v1/clusters` | `RequireAuth` | Lists registered clusters and active count. |
| `DELETE` | `/api/v1/clusters?clusterId=...` | `RequireClusterAuth` | Unregisters cluster and stops its informers/log streams. |
| `POST` / `DELETE` | `/api/v1/clusters/unregister-all` | `RequireAdmin` | Stops and clears all registered cluster informers. |
| `POST` / `DELETE` | `/api/v1/logs/stream` | `RequireAuth` + Cluster Auth | Starts or stops background `PodLogStreamer` session emitting `EVENT_LOG_LINE`. |
| `POST` / `DELETE` | `/api/v1/chaos/inject` | `RequireAuth` + Cluster Auth | Injects (`crash`, `oom-pressure`, `scale-down`, optional `force`) or reverts (`faultId`) chaos faults; returns `409` on PDB block. |
| `GET` | `/api/v1/chaos/faults` | `RequireAuth` + Cluster Auth | Lists active in-flight chaos faults (`?clusterId=`). |
| `GET` / `POST` / `DELETE` | `/api/v1/evaluator/rules` | `RequireAuth` (`GET`) / `RequireAdmin` (`POST`, `DELETE`) | Reads, syncs, adds, or deletes metric evaluator alert rules. |
| `POST` | `/api/v1/clusters/{clusterId}/rollout/rollback` *(+ aliases)* | `AuthenticateRequest` + Cluster Auth | Conflict-safe Deployment rollback to target ReplicaSet revision/hash. |
| `DELETE` / `POST` | `/api/v1/resource/delete` | `AuthenticateRequest` + Cluster Auth | Physically deletes Pod, Service, Deployment, StatefulSet, ReplicaSet, or Ingress via `client-go`. |

---

## 3. WebSocket Event Envelope & Event Catalog

Every event broadcast on `/ws/k8s` uses `WSEventEnvelope` ([`events.go`](../apps/k8s-streamer/pkg/types/events.go#L89-L94)):
```json
{
  "event": "EVENT_POD_STATUS_CHANGED",
  "clusterId": "<cluster-uuid>",
  "timestamp": "2026-11-20T15:30:00.123456Z",
  "data": { }
}
```

| Domain | Event Constants | Go Payload Struct |
| :--- | :--- | :--- |
| **Baseline & Heartbeat** | `EVENT_SNAPSHOT_SYNC`, `EVENT_HEARTBEAT`, `EVENT_CLUSTER_METRICS` | `ClusterSnapshot`, Heartbeat, `ClusterMetricPoint` |
| **Core Topology** | `EVENT_POD_STATUS_CHANGED`, `EVENT_POD_DELETED`, `EVENT_NODE_MUTATED`, `EVENT_SERVICE_MUTATED`, `EVENT_INGRESS_MUTATED` | `PodStatusDelta`, `NodeStatusDelta`, `ServiceStatusDelta`, `IngressStatusDelta` |
| **Workloads & Rollouts** | `EVENT_DEPLOYMENT_MUTATED`/`DELETED`, `EVENT_REPLICA_SET_MUTATED`/`DELETED`, `EVENT_STATEFUL_SET_MUTATED`/`DELETED`, `EVENT_DAEMONSET_MUTATED`/`DELETED`, `EVENT_ROLLOUT_ROLLBACK` | `DeploymentStatusDelta`, `ReplicaSetStatusDelta`, `StatefulSetStatusDelta`, `DaemonSetStatusDelta` |
| **Batch Workloads** | `EVENT_JOB_MUTATED`/`DELETED`, `EVENT_CRONJOB_MUTATED`/`DELETED` | `JobStatusDelta`, `CronJobStatusDelta` |
| **Storage & Snapshots** | `EVENT_PVC_MUTATED`/`DELETED`, `EVENT_PV_MUTATED`/`DELETED`, `EVENT_VOLUME_SNAPSHOT_MUTATED`/`DELETED`, `EVENT_VOLUME_SNAPSHOT_CONTENT_MUTATED`/`DELETED` | `PVCStatusDelta`, `PVStatusDelta`, `VolumeSnapshotDelta`, `VolumeSnapshotContentDelta` |
| **Config & Secrets** | `EVENT_CONFIGMAP_MUTATED`/`DELETED`, `EVENT_SECRET_MUTATED`/`DELETED` | `ConfigMapStatusDelta`, `SecretStatusDelta` (keys only) |
| **Policies & Quotas** | `EVENT_HPA_MUTATED`/`DELETED`, `EVENT_NETWORKPOLICY_MUTATED`/`DELETED`, `EVENT_PDB_MUTATED`/`DELETED`, `EVENT_RESOURCE_QUOTA_MUTATED`/`DELETED`, `EVENT_LIMIT_RANGE_MUTATED`/`DELETED` | `HPAStatusDelta`, `NetworkPolicyStatusDelta`, `PDBStatusDelta`, `ResourceQuotaStatusDelta`, `LimitRangeStatusDelta` |
| **In-Cluster RBAC** | `EVENT_SERVICEACCOUNT_MUTATED`/`DELETED`, `EVENT_ROLE_MUTATED`/`DELETED`, `EVENT_ROLEBINDING_MUTATED`/`DELETED`, `EVENT_CLUSTERROLE_MUTATED`/`DELETED`, `EVENT_CLUSTERROLEBINDING_MUTATED`/`DELETED` | `ServiceAccountDelta`, `RoleDelta`, `RoleBindingDelta`, `ClusterRoleDelta`, `ClusterRoleBindingDelta` |
| **Logs, Alerts & Chaos** | `EVENT_LOG_LINE`, `EVENT_POD_ANOMALY_DETECTED`, `EVENT_ALERT_TRIGGERED`, `EVENT_K8S_INCIDENT_CREATED`, `EVENT_CHAOS_FAULT_INJECTED`, `EVENT_CHAOS_FAULT_CLEARED` | `LogStreamEvent`, `PodAnomalyEvent`, `AlertTriggeredEvent`, `K8sIncidentEvent`, `ChaosFaultEvent` |

---

## 4. Zod Validation Constraints & JSON Request/Response Examples

### Strict Zod Schema Rules ([`request.schemas.ts`](../apps/api-server/src/schemas/request.schemas.ts))
- **`credentialsSchema` / `registerSchema`:** Lowercases and trims `email` (`z.string().email()`), enforces `password` length `8..128`, and `name` length `1..255`.
- **`workspaceSchema`:** `name` (`1..255`), optional `slug` matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`, optional `description` (`<= 5000`).
- **`memberSchema`:** `userId` UUID + `role` in `["ADMIN", "MEMBER", "VIEWER"]`.
- **`clusterConnectSchema`:** `name` (`1..255`), `type` (default `"kubernetes"`), optional `connectionMode` (`"direct"` \| `"agent"`, default `"direct"`), and optional `kubeconfig` (`<= 2_000_000` bytes). In `connectCluster`, `connectionMode === "agent"` (or omitted `kubeconfig`) creates a `waiting_for_agent` record (`apiServerUrl: "agent://in-cluster"`); `direct` mode validates YAML syntax & current cluster URL before AES-256-GCM encryption.
- **`clusterLayoutSchema`:** `{ positions: Record<string, { x: number, y: number }> }`.
- **`alertPolicySchema`:** `clusterId` UUID, `name`, `metric` (`CPU` \| `MEMORY` \| `POD_RESTART`), finite `threshold` (`-99_999_999.99` to `99_999_999.99`), `operator` (`>` \| `<` \| `>=` \| `<=`), positive int `duration`, `severity` (`info` \| `warning` \| `error` \| `critical`), optional `conditions`, and `notificationChannels`.
- **`healthHistoryQuerySchema`:** Coerces `days` integer to `1..90` (default `7`).

### Sample Gateway & Mutation Payloads

- **Deployment Rollback (`POST /api/v1/clusters/{clusterId}/rollout/rollback` — [`rollback_handler.go`](../apps/k8s-streamer/pkg/server/rollback_handler.go)):**
  ```json
  // Request (provide replicaSetName, targetRevision, or targetHash)
  {
    "clusterId": "cluster-uuid",
    "namespace": "testing-todo",
    "deploymentName": "todo-backend",
    "targetRevision": "2",
    "targetHash": "64cb5bb774",
    "replicaSetName": "todo-backend-64cb5bb774"
  }
  // 200 OK Response
  {
    "status": "success",
    "message": "Deployment todo-backend rolled back to revision #64cb5bb774",
    "deployment": "todo-backend",
    "namespace": "testing-todo",
    "revision": "2",
    "hash": "64cb5bb774"
  }
  ```

- **Chaos Injection (`POST /api/v1/chaos/inject` — [`routes_chaos.go`](../apps/k8s-streamer/pkg/server/routes_chaos.go)):**
  ```json
  // Request
  { "clusterId": "cluster-uuid", "namespace": "testing-todo", "name": "todo-backend-abc", "faultType": "crash", "force": false }
  // 200 OK
  { "status": "injected", "faultId": "fault-1763661000", "faultType": "crash", "target": "todo-backend-abc", "namespace": "testing-todo", "clusterId": "cluster-uuid", "force": false }
  // 409 Conflict (when force=false and PDB disruptionsAllowed - activeInflight <= 0)
  { "status": "blocked_by_pdb", "pdbName": "todo-backend-pdb", "disruptionsAllowed": 0, "workload": "todo-backend", "namespace": "testing-todo", "message": "..." }
  ```

- **Physical Resource Delete (`DELETE` or `POST /api/v1/resource/delete` — [`routes_resource.go`](../apps/k8s-streamer/pkg/server/routes_resource.go)):**
  ```json
  // Request (supported kinds: Pod, Service, Deployment, StatefulSet, ReplicaSet, Ingress)
  { "clusterId": "cluster-uuid", "namespace": "testing-todo", "resourceKind": "Pod", "resourceName": "todo-backend-abc" }
  // 200 OK
  { "status": "deleted", "clusterId": "cluster-uuid", "namespace": "testing-todo", "resourceKind": "Pod", "resourceName": "todo-backend-abc", "timestamp": "2026-11-20T15:30:00Z" }
  ```

---

## 5. Snapshot & Core WebSocket Delta Schemas

- **`ClusterSnapshot` & Snapshot Endpoints ([`snapshot.go`](../apps/k8s-streamer/pkg/types/snapshot.go), [`routes.go`](../apps/k8s-streamer/pkg/server/routes.go), [`agent_snapshot.go`](../apps/k8s-streamer/pkg/k8s/agent_snapshot.go)):**
  - `types.ClusterSnapshot` declares 22 top-level Go slices (`pods`, `nodes`, `services`, `deployments`, `replicaSets`, `statefulSets`, `daemonSets`, `ingresses`, `incidents`, `cronJobs`, `jobs`, `pvcs`, `pvs`, `configMaps`, `secrets`, `hpas`, `networkPolicies`, `pdbs`, `resourceQuotas`, `limitRanges`, `volumeSnapshots`, `volumeSnapshotContents`).
  - `GET /api/v1/clusters/snapshot` returns **25 resource arrays** (the first 20 core/workload/storage/policy/quota slices above plus the 5 RBAC slices `serviceAccounts`, `roleBindings`, `clusterRoleBindings`, `roles`, `clusterRoles`) and `metricsHistory`; `volumeSnapshots` and `volumeSnapshotContents` are currently delivered via live WebSocket delta events (`EVENT_VOLUME_SNAPSHOT_*`, `EVENT_VOLUME_SNAPSHOT_CONTENT_*`) rather than the REST snapshot payload.
  - Agent `BuildClusterSnapshot` currently populates **18 slices** (`pods` through `pdbs` — omitting `resourceQuotas`, `limitRanges`, `volumeSnapshots`, `volumeSnapshotContents`, and RBAC slices from the initial agent baseline frame).
- **`PodStatusDelta` ([`events.go`](../apps/k8s-streamer/pkg/types/events.go#L97-L126)):** `name`, `namespace`, `nodeName`, `podIp`, `phase`, `isTerminating`, `restartCount`, `cpuUsageMcores`, `memoryUsageMiB`, `cpuUsagePct`, `memoryUsageMb`, `labels`, `ownerUid`/`ownerName`/`ownerKind`, `isStaticPod`, `isControlPlane`, `exitCode`, `terminationReason`, `livenessProbe`/`readinessProbe` (`ProbeSpecInfo`), `volumes` (`PodVolumeMountInfo[]`), `configMaps`, `secrets`, `serviceAccountName`, `automountServiceAccountToken`, `createdAt`.
- **`StatefulSetStatusDelta` ([`statefulset.go`](../apps/k8s-streamer/pkg/types/statefulset.go)):** `replicas`, `readyReplicas`, `currentReplicas`, `updatedReplicas`, `serviceName`, `currentRevision`, `updateRevision`, `updateStrategy`, `partition`, `volumeClaimTemplates[]` (`name`, `storage`, `accessModes`).
- **`VolumeSnapshotDelta` & `VolumeSnapshotContentDelta` ([`storage_snapshot.go`](../apps/k8s-streamer/pkg/types/storage_snapshot.go)):** Captures `readyToUse`, `restoreSize`, `pvcName`, `snapshotContentName`, `snapshotClassName`, `snapshotHandle`, `driver`, `deletionPolicy`, `volumeSnapshotRef`, and `error`.
- **Governance Deltas (`ResourceQuotaStatusDelta`, `PDBStatusDelta`, `HPAStatusDelta`, `RBAC` structs in [`rbac.go`](../apps/k8s-streamer/pkg/types/rbac.go)):** Precomputed utilization percentages (`cpuUtilizationPct`, `memoryUtilizationPct`, `podsUtilizationPct`, `isWarning`, `isBreached`), PDB `disruptionsAllowed`, HPA min/max/current/desired replicas & CPU util, and RBAC `roleRef`, `subjects[]`, and `rules[]` (`verbs`, `apiGroups`, `resources`, `resourceNames`).

---

## 6. Standard HTTP Status & Error Catalog

| HTTP Status | Trigger Condition & Response Shape |
| :--- | :--- |
| **`200` / `201` / `204`** | Standard read/mutation success (`200`), resource/workspace/cluster creation (`201`), and idempotent deletion (`204 No Content`). |
| **`400 Bad Request`** | Zod validation failure (`validate.ts` returns `{ error, details: flattenedErrors }`) or missing required gateway JSON fields. |
| **`401 Unauthorized`** | Missing/expired/invalid JWT Bearer token or unauthenticated `/api/v1/*` request when `ALLOW_ANONYMOUS_WS != "true"`. |
| **`403 Forbidden`** | Workspace RBAC role insufficiency (e.g., `VIEWER` mutating) or JWT `allowedClusterIds` scope denial (`CheckClusterAuthorization`). |
| **`404 Not Found`** | Missing cluster/workspace/policy/incident record or target ReplicaSet revision/cluster clientset not registered. |
| **`409 Conflict`** | `POST /api/v1/chaos/inject` blocked by PodDisruptionBudget SLA guardrail (`{ status: "blocked_by_pdb", pdbName, disruptionsAllowed }`). |
| **`422 Unprocessable`** | `ClusterConnectionError` during `direct` cluster onboarding when kubeconfig YAML parsing or server URL extraction fails. |
| **`429 Too Many Req`** | `express-rate-limit` triggered (`> 100 req/min` on `/api/v1/` or `> 10 req/15min` on `/api/v1/auth/login`). |
| **`500 Internal Error`** | Unhandled API exception or upstream `client-go` mutation failure. |
