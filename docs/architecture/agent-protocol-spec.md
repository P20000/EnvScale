# EnvScale — Authoritative Agent Protocol Specification (v2.0)

> **Status:** Authoritative Wire Contract (Phase 2+)  
> **Scope:** Transport, authentication, handshake/versioning, session CAS ownership, snapshot/delta reconciliation, multiplexed log streaming, metrics transport, and durable bidirectional command execution.

---

## 1. Transport, TLS & Authentication

- **Endpoint:** Outbound `WSS /ws/agent` (or `WS` only in local non-TLS dev) initiated by `envscale-agent` (`apps/k8s-streamer/pkg/agent/runner.go`) to `apps/k8s-streamer` (`pkg/server/agent_receiver.go`).
- **Header Auth Only:** Agent sends `Authorization: Bearer <agentToken>` on the WebSocket upgrade HTTP request. Never pass tokens in URL query parameters and never log the token or full credentialed URL to stdout.
- **Strict TLS:** Agent validates the server certificate against the container trust store (`/etc/ssl/certs/ca-certificates.crt`) or an explicitly supplied `CA_CERT_PATH` / `CA_CERT_PEM`. **`InsecureSkipVerify: true` is strictly prohibited.**
- **Cluster-Bound Revocable Credentials:**
  - `agentToken` carries `tokenType: "agent"`, `sub: "agent-<clusterUUID>"`, `clusterId: "<clusterUUID>"`, `tokenId: "<uuid>"`.
  - `HandleAgentWebSocket` **must** verify `tokenType == "agent"`, match `claims["clusterId"] == query("clusterId")`, and validate `tokenId` is active (not revoked/deleted) via `api-server` / shared Redis revocation state.
  - Token is mounted into the Agent pod via a Kubernetes `Secret` (`envFrom` / `secretKeyRef`), never plaintext Deployment `env.value`.

---

## 2. Handshake, Versioning & Session Ownership

### 2.1 Handshake Sequence (`v2.0`)

```text
Agent                                        k8s-streamer (/ws/agent)
  │──── HTTP Upgrade (Authorization: Bearer) ───►│ Validate JWT + clusterId + revocation
  │◄─── 101 Switching Protocols ─────────────────│
  │──── AGENT_HELLO (protocolVersion: "2.0") ───►│ Bind AgentSession{sessionId, writeMu}
  │◄─── SERVER_HELLO_ACK (sessionId, intervals) ─│ Update DB status -> connected/degraded
  │──── EVENT_SNAPSHOT_SYNC (full + caps) ──────►│ Store baseline & broadcast to UI hub
  │◄═══ Bidirectional Multiplexed Frames ═══════►│ Ping/Pong, Deltas, Metrics, Logs, Commands
```

- **`AGENT_HELLO` Payload (Agent → Server):**
  ```json
  {
    "event": "AGENT_HELLO",
    "clusterId": "<uuid>",
    "timestamp": "2026-11-27T12:00:00Z",
    "data": {
      "protocolVersion": "2.0",
      "agentVersion": "sha-abcdef12",
      "k8sVersion": "v1.30.2",
      "permissionProfile": "readonly",
      "namespaces": ["*"],
      "capabilities": { "logs": { "state": "supported_working" }, "...": {} },
      "resources": { "core/v1/pods": { "state": "supported_working" }, "...": {} }
    }
  }
  ```
- **`SERVER_HELLO_ACK` Payload (Server → Agent):**
  ```json
  {
    "event": "SERVER_HELLO_ACK",
    "clusterId": "<uuid>",
    "timestamp": "2026-11-27T12:00:00Z",
    "data": {
      "accepted": true,
      "protocolVersion": "2.0",
      "sessionId": "<server-generated-uuid>",
      "heartbeatIntervalSec": 20,
      "metricsIntervalSec": 15,
      "resyncIntervalSec": 60
    }
  }
  ```

### 2.2 Backward Compatibility (`v1.0` Legacy Agents)

If the first frame after upgrade is `EVENT_SNAPSHOT_SYNC` (instead of `AGENT_HELLO`), the receiver registers a `protocolVersion: "1.0"` read-only session:
- `topology` is `supported_working`; `logs`, `metrics`, `deployment_scale`, `resource_delete`, `resource_apply`, `deployment_rollback`, `chaos_*` are marked `not_implemented` with reason `"Agent protocol v1.0 does not support bidirectional execution; upgrade agent manifest"`.
- Mutating operations fail immediately with `ErrCapabilityUnsupported` rather than hanging or hitting another cluster.

### 2.3 Session CAS Ownership, Thread Safety & Reconnects

- **Single Serialized Writer:** Every `*AgentSession` owns a dedicated write channel / `writeMu` mutex (`gorilla/websocket` allows only one concurrent writer).
- **Compare-and-Swap Disconnect:** `AgentRegistry.MarkDisconnected(clusterID, sessionID)` only clears `Connected = false` and aborts active streams/pending commands if `state.ActiveSessionID == sessionID`. If a replacement pod/reconnect already registered a new `sessionID`, the old socket is closed and ignored on exit.
- **Heartbeats:** Agent sends WS Ping every `heartbeatIntervalSec` (20s); Server resets 60s read deadline on Pong/frames. Reconnect uses exponential backoff (2s → 30s with jitter).
- **Cluster Deletion Cleanup:** Unregistering a cluster immediately closes its active `AgentSession` WS connection, cancels all log streams for that `clusterID`, and marks in-flight commands aborted/reconciling.

---

## 3. Snapshot Synchronization & Delta Reconciliation

- **Full Baseline (`EVENT_SNAPSHOT_SYNC`):** Sent immediately after `SERVER_HELLO_ACK` and every `resyncIntervalSec` (60s). Payload includes **all** permitted `types.ClusterSnapshot` fields (`pods`, `nodes`, `services`, `deployments`, `replicaSets`, `statefulSets`, `daemonSets`, `ingresses`, `incidents`, `cronJobs`, `jobs`, `pvcs`, `pvs`, `configMaps`, `secrets`, `hpas`, `networkPolicies`, `pdbs`, `resourceQuotas`, `limitRanges`, `volumeSnapshots`, `volumeSnapshotContents`, plus `namespaces`, `endpoints`, and `rbac` collections) and `capabilities`.
- **Complete Delta Reducer (`AgentRegistry.ApplyDelta`):** Must apply **every** `EVENT_*` constant (not just the current 6 of 34) to `AgentClusterState.Snapshot` under lock before calling `hub.RouteRaw(clusterID, msg)`, ensuring REST `/snapshot` and live WS subscribers remain consistent.

---

## 4. Multiplexed Log Streaming & Cancellation

All log frames share `/ws/agent` multiplexed by `streamId` (UUID per browser log session):

| Frame (`event`) | Direction | Required Fields | Behavior |
| :--- | :--- | :--- | :--- |
| `LOG_STREAM_START` | Server → Agent | `streamId`, `namespace`, `kind`, `name`, `container`, `tailLines`, `follow`, `sinceSeconds`, `timestamps` | Agent checks capability/RBAC, starts `LogStreamManager` scoped to `streamId`. |
| `LOG_FRAME` | Agent → Server | `streamId`, `timestamp`, `namespace`, `pod`, `container`, `source`, `level`, `message`, `stream` | Routed by `streamId` to matching `HandleUniversalLogStream` client channel. |
| `LOG_DIAGNOSTIC` | Agent → Server | `streamId`, `code` (`no_logs` \| `container_not_found` \| `permission_denied` \| `pod_restarted` \| `stream_terminated` \| `cluster_unavailable`), `reason`, `pod`, `container`, `retryCount` | Propagated verbatim to browser `useResourceLogs` diagnostics & banner. |
| `LOG_STREAM_STATUS` | Agent → Server | `streamId`, `scope`, `containers[]` (`active` \| `retrying` \| `failed` \| `terminated`) | Updates UI stream health summary. |
| `LOG_STREAM_STOP` | Server → Agent | `streamId`, `reason` (`client_closed` \| `timeout` \| `cluster_deleted`) | Agent immediately cancels `streamId`'s child `context.Context`. |

**Backpressure:** Each stream sink has a bounded channel; if a slow browser client lags, `k8s-streamer` drops excess frames and emits a `LOG_DIAGNOSTIC` warning (`stream_backpressure`) rather than blocking the agent WebSocket loop.

---

## 5. Metrics Transport (`METRICS_BATCH`)

- **Cadence:** Agent polls `metrics.k8s.io/v1beta1` (`PodMetricses`, `NodeMetricses`) every `metricsIntervalSec` (default **15s**), aligned to UTC bucket boundaries (`floor(unix / 15) * 15`).
- **Frame (`METRICS_BATCH`, Agent → Server):**
  ```json
  {
    "event": "METRICS_BATCH",
    "clusterId": "<uuid>",
    "sessionId": "<uuid>",
    "timestamp": "2026-11-27T12:00:15Z",
    "data": {
      "sampledAt": "2026-11-27T12:00:15Z",
      "status": "ok",
      "reason": "",
      "cluster": { "cpuUsedMcores": 420, "cpuAllocatableMcores": 4000, "cpuPct": 10.5, "memUsedMiB": 1024, "memAllocatableMiB": 8192, "memPct": 12.5, "podCount": 14, "nodeCount": 1 },
      "nodes": [{ "name": "minikube", "cpuUsedMcores": 420, "cpuPct": 10.5, "memUsedMiB": 1024, "memPct": 12.5 }],
      "topPods": [{ "namespace": "default", "name": "api-1", "cpuUsedMcores": 120, "memUsedMiB": 256 }]
    }
  }
  ```
- If `metrics.k8s.io` is missing or RBAC returns 403, Agent sends `status: "cluster_unavailable"` or `"permission_denied"` with the exact Kubernetes error—never omitting silently or fabricating capacity (`2000`/`4096`).

---

## 6. Bidirectional Command Execution Contract

Used in Phase 5 for `scale_deployment`, `delete_resource`, `apply_resource`, `rollback_deployment`, `chaos_inject`, `chaos_clear`, and on-demand `get_resource` / `check_pdb`.

- **`CMD_REQUEST` (Server → Agent):** `{ commandId, clusterId, sessionId, operationType, idempotencyKey, payload, issuedAt, expiresAt, timeoutMs, actorContext: { userId, workspaceRole } }`.
- **`CMD_ACK` (Agent → Server):** `{ commandId, sessionId, status: "accepted" | "rejected_expired" | "rejected_unauthorized" | "duplicate", receivedAt }`.
- **`CMD_RESULT` (Agent → Server):** `{ commandId, sessionId, status: "succeeded" | "failed", result, errorCode, errorMessage, completedAt }`.

### Reliability & Failure Rules
1. **Durable Command Record:** `api-server` persists `cluster_commands` (`pending → dispatched → acked → running → succeeded | failed | expired | unknown_reconciling`) before dispatch.
2. **Never Blindly Retry Destructive Commands:** If WebSocket disconnects or backend restarts while a command is `dispatched` / `running`, status transitions to `unknown_reconciling`. On reconnect, the control plane reconciles against live K8s state (e.g. deployment replicas, revision hash, pod UID) rather than re-issuing blind deletes/mutations.
3. **Duplicate Delivery & Lost ACK:** Agent caches `(commandId -> CMD_RESULT)` in a bounded LRU/TTL cache and re-emits the cached result with `CMD_ACK(status="duplicate")` if redelivered within the same session; across reconnects, operation preconditions (`expectedResourceVersion`, `expectedRevision`, `podUid`) enforce idempotency.
4. **Expiry Guard:** Agent checks `time.Now().UTC().After(expiresAt)` prior to executing any `CMD_REQUEST` and returns `CMD_ACK(status="rejected_expired")`.
