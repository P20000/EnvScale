# Cluster Lifecycle, Startup Hydration & Automatic Resilience

> **Audience:** Core System Developers (Pranav, Vinit, Neha, Ishika) & Architecture Reviewers  
> **Module Ownership:** `apps/api-server` (Vinit), `apps/k8s-streamer` (Pranav), `apps/web` (Neha), `docs/` (Ishika)  
> **Status:** Production Standard Architecture

---

## 1. High-Level Problem & Architectural Context

In **EnvScale**, cluster state and observability are distributed across two specialized microservices:

1. **REST API Server (`apps/api-server`):**
   - Source of truth for workspace metadata, user RBAC, alert policies, and clusters.
   - Stores cluster credentials using **AES-256-GCM encrypted Kubeconfigs** in PostgreSQL (`clusters.kubeconfig`).
2. **Streaming Gateway (`apps/k8s-streamer`):**
   - High-throughput Go WebSocket gateway using `client-go` `SharedInformerFactory` (`PodInformer`, `NodeInformer`, `ServiceInformer`).
   - Maintains Informers, caches, and WebSocket broadcast rooms purely **in-memory** (`ClusterManager.clusters map[string]*InformerManager`).

### The Out-of-Order Startup Challenge
In developer and production environments, the application stack and the Kubernetes clusters rarely boot in a perfectly synchronized sequence:
- A developer runs `localrun` (Launch App Stack), uploads a kubeconfig in the UI, and **only then** starts Minikube / K3s.
- `k8s-streamer` or `api-server` restarts or crashes, losing in-memory Informers while PostgreSQL retains the cluster definitions.
- Network partitions or API server restarts temporarily disconnect the Kubernetes API server.

Previously, if `k8s-streamer` received a cluster registration while the cluster was offline, the initial handshake (`clientset.Discovery().ServerVersion()`) failed, returning `400 Bad Request`. Without a retry or sync engine, the cluster was discarded from memory, and the frontend remained completely blank even after the cluster came online.

---

## 2. Self-Healing & Resilience Architecture

To make EnvScale completely resilient to startup order, transient network partitions, and service restarts, EnvScale implements a **4-tier self-healing loop**:

```text
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │                                   POSTGRESQL                                   │
 │                Persistent Store (Encrypted AES-256-GCM Kubeconfigs)            │
 └──────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                         1. Startup Hydration / Reconcile
                                        ▼
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │                            API SERVER (apps/api-server)                        │
 │                                                                                │
 │  ┌─────────────────────────────┐         ┌──────────────────────────────────┐  │
 │  │  hydrateClustersOnStartup() │         │ cluster-reconcile.worker.ts      │  │
 │  │  (Runs on boot)             │         │ (Recursive setTimeout, 20s tick) │  │
 │  └──────────────┬──────────────┘         └────────────────┬─────────────────┘  │
 │                 │                                         │                    │
 │                 └───────────────────┬─────────────────────┘                    │
 │                                     │                                          │
 │                        syncClusterWithStreamer()                               │
 │                  (Decodes Kubeconfig, checks healthz)                          │
 └─────────────────────────────────────┼──────────────────────────────────────────┘
                                       │
                        POST /api/v1/clusters/register
                                       ▼
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │                        STREAMING GATEWAY (apps/k8s-streamer)                   │
 │                                                                                │
 │   - Idempotent RegisterCluster()                                               │
 │   - Starts client-go Informers if reachable (pods, nodes, services, etc.)      │
 │   - Returns 200 OK -> DB status updated to 'connected'                         │
 │   - Returns 400 Bad Request -> DB status updated to 'disconnected'             │
 └─────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                       WebSocket deltas & REST Snapshot
                                       ▼
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │                              WEB UI (apps/web)                                 │
 │                                                                                │
 │   - useK8sStream hook connects to ws://localhost:8080/ws/k8s                   │
 │   - Exponential backoff retry on /snapshot (1.5s, 2.7s, 4.8s, 8.7s, 12s)       │
 │   - Circuit Breaker trips after 5 attempts -> "Cluster Offline" badge          │
 └────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Architectural Components

### 3.1 Startup Cluster Hydration (`hydrateClustersOnStartup`)
- **Location:** `apps/api-server/src/services/cluster-sync.service.ts`
- **Trigger:** Invoked inside `app.listen()` when `api-server` boots.
- **Mechanism:**
  1. Queries all clusters from the PostgreSQL `clusters` table.
  2. For each cluster with a stored kubeconfig, decrypts the secret in ephemeral memory using AES-256-GCM.
  3. POSTs payload to `${K8S_STREAMER_URL}/api/v1/clusters/register`.
  4. Automatically reconciles status: sets `status = "connected"` upon success, or `"disconnected"` if the cluster is still starting.

### 3.2 Recursive Background Reconciliation Worker
- **Location:** `apps/api-server/src/workers/cluster-reconcile.worker.ts`
- **Trigger:** Scheduled after server boot (default interval: `20,000ms`, configurable via `CLUSTER_RECONCILE_INTERVAL_MS`).
- **Critical Failure Guardrails:**
  1. **Anti-Thundering Herd & Non-Overlapping Execution:**
     - Uses an `isReconciling` mutex boolean lock.
     - Uses **recursive `setTimeout`** rather than rigid `setInterval`. The next cycle is scheduled *only after* the previous cycle has completely finished (even if Kubernetes API timeouts take 10+ seconds).
  2. **Streaming Gateway Pre-Flight Check:**
     - Pings `${K8S_STREAMER_URL}/healthz` before performing any decryption work. If the streaming gateway is offline, the cycle aborts early without redundant CPU or network load.
  3. **Clean Teardown on Process Exit:**
     - Exposes `stopClusterReconcileWorker()` which clears the active timer and resets worker state.
     - Hooked directly to `SIGINT` and `SIGTERM` process exit handlers in `apps/api-server/src/index.ts`.

### 3.3 Dynamic PostgreSQL Cluster State Tracking
- **Location:** `apps/api-server/src/db/schema/clusters.ts`
- **Field:** `status: varchar("status", { length: 50 }).default("disconnected")`
- **Behavior:**
  - Cluster records are no longer optimistically assumed to be `"connected"`.
  - When `connectCluster` runs, the cluster is saved as `"disconnected"`. If the initial handshake succeeds, it is immediately updated to `"connected"`.
  - If the cluster was offline when registered, it remains `"disconnected"` until the background reconciler successfully connects it when Minikube/K8s starts up.

### 3.4 Frontend Exponential Backoff & Circuit Breaker
- **Location:** `apps/web/src/hooks/useK8sStream.ts`
- **Behavior:**
  - When the WebSocket connects to `ws://localhost:8080/ws/k8s?clusterId=...`, the hook queries `/api/v1/clusters/snapshot?clusterId=...`.
  - If the cluster is still being initialized or registered by the background worker (returning 404), the client applies **exponential backoff**:
    $$\text{delay} = \min(1500 \times 1.8^{\text{attempt}}, 12000)\text{ ms}$$
  - **Circuit Breaker:** Hard-capped at **5 attempts**. If the cluster remains unreachable after 5 attempts, retrying stops and the UI surfaces an explicit `"Cluster Offline / Waiting for Connection"` notification to prevent infinite background request spam.

---

## 4. Security & Cryptographic Integrity

1. **AES-256-GCM at Rest:** Raw Kubeconfigs are **never** stored in plain text or logged to stdout/stderr.
2. **Ephemeral In-Memory Decryption:** Kubeconfigs are decrypted exclusively in memory within `api-server` during the sync call and sent directly over localhost HTTP to `k8s-streamer`.
3. **Public API Shielding:** `publicClusterFields` in `cluster.service.ts` excludes the `kubeconfig` column from all REST API responses, preventing secret leaks to the browser.

---

## 5. Verification Matrix

| Scenario | Expected System Behavior | Verified |
| :--- | :--- | :---: |
| **Normal Order (Cluster Up → Stack Up)** | Cluster registered on startup hydration; status = `connected`; topology loads in < 500ms. | ✅ |
| **Inverted Order (Stack Up → Kubeconfig Added → Cluster Up Later)** | Kubeconfig saved as `disconnected`; background reconciler detects cluster when started; auto-syncs; topology renders without browser reload. | ✅ |
| **Streamer Restart** | Streamer restarts empty; next 20s reconciler cycle re-registers all clusters from DB into streamer memory. | ✅ |
| **Process Shutdown** | `SIGINT`/`SIGTERM` invokes `stopClusterReconcileWorker()`, clearing active timer handles with zero leaked background processes. | ✅ |
| **Dead Cluster** | Frontend circuit breaker trips after 5 attempts; displays offline warning; no infinite network loop. | ✅ |
