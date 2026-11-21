# EnvScale Kubernetes Streaming Gateway & Agent (`apps/k8s-streamer`)

High-concurrency **Go 1.24** service (`k8s.io/client-go v0.30.2`, Gorilla WebSocket, `go-redis/v9`) operating in two modes:
1. **Gateway Mode (Default, `:8080`):** Watches target clusters via `SharedInformerFactory` and dynamic CSI snapshot informers, emits sub-200ms FNV-1a deduplicated `EVENT_*` deltas over `/ws/k8s`, multiplexes multi-container logs over `/ws/logs`, evaluates metric alerts, executes 1-click Deployment rollbacks, and injects reversible chaos faults.
2. **In-Cluster Agent Mode (`MODE=agent`):** Runs inside private/firewalled Kubernetes clusters (`pkg/agent/runner.go`) and dials outbound to the gateway's `/ws/agent` receiver without exposing control-plane ports.

---

## Key Capabilities & Endpoints

- **Informer Coverage (`pkg/k8s`):** Pods (including static/mirror & probes), Nodes, Services, Ingresses, Events, Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, PVCs, PVs, ConfigMaps & Secrets (keys-only sanitized), HPAs, NetworkPolicies, PDBs, ResourceQuotas, LimitRanges, In-Cluster RBAC, CSI `VolumeSnapshot` / `VolumeSnapshotContent`, and 1-second metrics polling (`informer_metrics.go`).
- **WebSocket Endpoints:**
  - `/ws/k8s`: Cluster-scoped live topology & 1s metrics stream (`EVENT_CLUSTER_METRICS`)
  - `/ws/agent`: Outbound agent tunnel receiver (`AgentRegistry`)
  - `/ws/logs`, `/ws/stream/logs`, `/api/v1/stream/logs`: Universal multi-container log & event multiplexer (`LogStreamManager`)
- **HTTP Control & Diagnostics Endpoints:**
  - `GET /healthz`: Active clients, clusters, log streams, chaos faults, alert rules, and Redis status
  - `POST /api/v1/clusters/register`, `GET /api/v1/clusters`, `DELETE /api/v1/clusters`, `POST|DELETE /api/v1/clusters/unregister-all`
  - `GET /api/v1/clusters/snapshot`, `GET /api/v1/clusters/metrics/history`
  - `POST|DELETE /api/v1/logs/stream`, `GET|POST|DELETE /api/v1/evaluator/rules`
  - `POST|DELETE /api/v1/chaos/inject`, `GET /api/v1/chaos/faults` (`crash`, `oom-pressure`, `scale-down` with PDB safety guardrails)
  - `POST /api/v1/clusters/{clusterId}/rollout/rollback` (plus `/api/v1/clusters/rollout/rollback`, `/api/v1/rollout/rollback`)
  - `DELETE|POST /api/v1/resource/delete`

---

## Local Development & Testing

```bash
cd apps/k8s-streamer
cp .env.example .env
go mod tidy
go run ./cmd/server/main.go
```

Run Go unit & race tests:
```bash
go test -v -race ./...
```

### Key Environment Variables ([`.env.example`](.env.example))
- `PORT`: Listener port (default `8080`)
- `NODE_ENV`: Set to `production` to enforce mandatory `JWT_ACCESS_SECRET` fail-closed guard
- `JWT_ACCESS_SECRET`: HMAC-SHA256 signing key shared with `apps/api-server`
- `ALLOW_ANONYMOUS_WS`: Local dev flag (`true` in `.env.example`, strictly `false` in production)
- `REDIS_URL`: Optional Redis Pub/Sub URL (`redis://localhost:6379`)
- `API_SERVER_URL`: Target base URL for internal incident trigger dispatches
- `MODE=agent` *(Agent Mode)*: Requires `CLUSTER_ID`, `SERVER_URL`, and `CLUSTER_TOKEN`

---

## Detailed Documentation

- [REST API & WebSocket Event Reference](../../docs/api-and-websocket-reference.md)
- [In-Cluster Agent & Onboarding](../../docs/in-cluster-agent-and-onboarding.md)
- [Workloads, StatefulSets & Rollouts](../../docs/k8s-workloads-and-rollouts.md)
- [Storage & CSI VolumeSnapshots](../../docs/storage-and-volume-snapshots.md)
- [Policies, Autoscaling, Quotas & RBAC](../../docs/policies-autoscaling-and-quotas.md)
- [Logging, Metrics & Diagnostics](../../docs/logging-metrics-and-diagnostics.md)
