# EnvScale — Authoritative Security & Compatibility Specification

> **Status:** Authoritative Implementation Contract (Phases 1–7)  
> **Scope:** Security remediation order, controlled cloud auth adapters, Agent RBAC profiles, Kubernetes compatibility targets, execution order, phase exit gates, and release acceptance criteria.

---

## 1. Security Findings & Remediation Order

Critical (`SEC-C*`) and cross-tenant (`SEC-H*`) defects **must be resolved before feature expansion** (Execution Step 2).

| ID | Severity | Verified Defect & Location | Required Remediation | Target Step |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-C1** | Critical | Fail-open `CheckClusterAuthorization` when `allowedClusterIds` omitted (`pkg/websocket/auth.go:149-154`) | Require `tokenType == "user"` (or `"service"`) and explicit UUID entry in `clusterRoles`; fail closed (`403`) on missing claims. | Step 2 |
| **SEC-C2** | Critical | Unbound `/ws/agent` discards `claims` (`pkg/server/agent_receiver.go:34-39`) | Verify `tokenType == "agent"`, exact `claims["clusterId"] == query("clusterId")`, and active `tokenId` in DB/revocation check. | Step 2 / Step 4 |
| **SEC-C3** | Critical | Cross-tenant `len == 1` & dev-alias fallbacks (`manager.go:171-183`, `agent_snapshot.go:61-68`) | Delete all `len == 1` and alias (`"minikube"`, `"default"`) fallbacks; require exact UUID match. | Step 2 |
| **SEC-C4** | Critical | Missing role checks on `k8s-streamer` chaos/delete/rollback (`routes_chaos.go`, `routes_resource.go`, `rollback_handler.go`) | Enforce `VIEWER` read-only vs `MEMBER`/`ADMIN` operational roles via `clusterRoles` claims and route mutations through `api-server`. | Step 2 / Step 6 |
| **SEC-C5** | Critical | Silent TLS `Insecure` fallback & hardcoded `InsecureSkipVerify: true` (`informer.go:65-76`, `runner.go:166`) | Remove all silent `Insecure` fallbacks; require valid system/uploaded CA bundle on both Direct & Agent. | Step 2 |
| **SEC-C6** | Critical | Uploaded kubeconfig allows arbitrary `user.exec` RCE & local file reads (`cluster.service.ts:71`, `informer.go:46`) | Reject `user.exec` and local path fields (`certificate-authority`, `client-certificate`, `client-key`, `tokenFile`) in kubeconfig validator; use controlled auth adapters (§2). | Step 2 |
| **SEC-H1** | High | Unscoped `DELETE /api/v1/chaos/inject` & multi-tenant `GET /api/v1/chaos/faults` (`routes_chaos.go:97-136`) | Require `clusterId` + `MEMBER`/`ADMIN` auth on both; scope list queries strictly to authorized cluster. | Step 2 / Step 6 |
| **SEC-H2** | High | Wildcard `*.duckdns.org` & `X-Forwarded-Host` origin trust (`client.go:36-47`, `main.go:95-97`) | Match exact configured `CORS_ORIGIN` allowlist only; drop wildcard `*.duckdns.org` and arbitrary forwarded host trust. | Step 2 |
| **SEC-H3** | High | Global `ADMIN` `["*"]` bypass & cluster-name collisions (`auth.go:123`, `auth.service.ts:45-74`) | Remove global `ADMIN` cross-workspace wildcard and remove cluster names from JWT claims (UUIDs only). | Step 2 |
| **SEC-H4** | High | Token in Agent stdout (`runner.go:173`), 7d JWT in `kubectl apply` URL (`AgentInstallStep.tsx:44`), plaintext Deployment env (`agent-manifest.service.ts:136`) | Move Agent WS auth to `Authorization` header; redact logs; issue short-lived single-use manifest download token; mount Agent token via K8s `Secret`. | Step 2 / Step 4 |
| **SEC-H5** | High | Cross-tenant leaks in `GET /api/v1/clusters`, `GET /api/v1/evaluator/rules`, `MetricEvaluator` (`routes.go:221,352`, `evaluator.go:307`) | Scope `clusters`/`rules` to caller's authorized UUIDs (or internal service auth) and require non-empty `rule.ClusterID`. | Step 2 |
| **SEC-H6** | High | Missing `requireClusterRole("ADMIN")` on top-level `DELETE /api/v1/clusters/:clusterId` (`cluster.routes.ts:32`) | Enforce `requireClusterRole("ADMIN")` consistently on top-level and workspace-scoped cluster delete routes. | Step 2 |
| **SEC-M1** | Medium | Missing rate limiting on `k8s-streamer` endpoints | Add streamer rate limiter before public production exposure. | Step 2 / Pre-Prod |
| **SEC-M2** | Medium | 30d stateless Agent JWTs lack DB-backed revocation | DB-backed `agent_tokens` table + `tokenId` revocation check on handshake & reconnect (documented in `agent-protocol-spec.md` §1.1). | Step 4 |
| **SEC-M3** | Medium | Single `KUBECONFIG_ENCRYPTION_KEY` without rotation | Support `v1`/`v2` encryption keyring rotation before production rollout. | Pre-Prod |
| **SEC-M4** | Medium | Logout called `/api/v1/clusters/unregister-all` (`useAuthStore.ts`) | **Remediated in Step 2:** Removed `unregister-all` from frontend logout; endpoint restricted strictly to internal `service` tokens. | Step 2 (Done) |
| **SEC-M5** | Medium | PDB safety check failed open on API/timeout/RBAC error (`safety.go`) | **Remediated in Step 2:** Explicit `*ErrPDBSafetyCheckFailed` fail-closed validation on pod/deployment/PDB lookup errors, timeouts, or 403s. | Step 2 (Done) |
| **SEC-L1..L2** | Low | Hardcoded dev JWT fallbacks (`auth.service.ts`); wrong `ENCRYPTION_KEY` check (`env.ts`) | **Remediated in Step 2:** Throw when JWT secrets unset, validate 32+ char non-placeholder secrets & base64 32-byte `KUBECONFIG_ENCRYPTION_KEY`. | Step 2 (Done) |
| **SEC-L3** | Low | Default Agent RBAC permitted `get`/`list`/`watch` on `secrets` (`agent-manifest.service.ts`) | **Remediated in Step 2:** Removed `secrets` from default Agent RBAC & default informer watches; topology uses Pod `SecretRefs` metadata only without reading Secret objects. | Step 2 (Done) |

---

## 2. Controlled Cloud Authentication Adapters (Direct Mode)

Direct kubeconfig connections **must never execute arbitrary `user.exec` binaries or read host filesystem paths** (`SEC-C6`). Both `api-server` (on upload) and `k8s-streamer` (before `client-go` instantiation) enforce a strict kubeconfig sanitizer:

1. **Rejected Fields:** Any `user.exec`, `user.auth-provider` with external commands, or filesystem path fields (`certificate-authority`, `client-certificate`, `client-key`, `tokenFile`) are rejected with `ErrInvalidKubeconfig` (`422`).
2. **Supported Direct Auth Modes:**
   - **`static-tls-or-token`:** Inline base64 `certificate-authority-data` + (`client-certificate-data` & `client-key-data`) or bearer `token`. Supports uploading an explicit CA bundle for private/self-signed clusters (Minikube, K3s, Kind, kubeadm).
   - **`oidc`:** Standard OIDC token/issuer metadata verified against strict CA.
   - **`aws-eks-sts` (EKS Adapter):** Explicit in-process AWS STS `GetCallerIdentity` presigned `k8s-aws-v1` bearer token generator configured via workspace-supplied IAM Role ARN / encrypted AWS credentials + cluster endpoint & CA data (zero `aws` CLI subprocesses).
   - **`gcp-gke-oauth` (GKE Adapter):** Explicit in-process Google OAuth2 / IAM token source using AES-256-GCM encrypted service account credentials + cluster CA data (zero `gke-gcloud-auth-plugin` binary execution).
   - **`azure-aks-entra` (AKS Adapter):** Explicit in-process Microsoft Entra ID token provider using encrypted service principal / federated token config + cluster CA data (zero `kubelogin` binary execution).

---

## 3. Agent Permission Profiles (Least-Privilege RBAC)

Generated manifests (`apps/api-server/src/services/agent-manifest.service.ts`) support two explicit profiles (`AGENT_IMAGE` pinned to `${STREAMER_IMAGE}` `@sha256` digest, token stored in Kubernetes `Secret`, optional namespace-scoped `Role`/`RoleBinding` mode):

| Profile | Intended Use | Exact Kubernetes RBAC Permissions |
| :--- | :--- | :--- |
| **Read-Only Observability** *(Default)* | Monitoring, topology, logs, metrics, auditing without mutation risk | `get`, `list`, `watch` on `pods`, `pods/log`, `nodes`, `namespaces`, `services`, `endpoints`, `endpointslices`, `events`, `configmaps`, `persistentvolumeclaims`, `persistentvolumes`, `deployments`, `replicasets`, `statefulsets`, `daemonsets`, `jobs`, `cronjobs`, `ingresses`, `networkpolicies`, `horizontalpodautoscalers`, `poddisruptionbudgets`, `resourcequotas`, `limitranges`, `serviceaccounts`, `roles`, `rolebindings`, `clusterroles`, `clusterrolebindings`, `volumesnapshots`, `volumesnapshotcontents`; `get`, `list` on `metrics.k8s.io` (`pods`, `nodes`). **Zero Kubernetes `secrets` read access and zero write verbs by default.** |
| **Operator** *(Explicit Admin Opt-In)* | Scaling, resource apply/delete, rollbacks, Chaos (`crash`, `scale-down`) | All Read-Only rules **plus** narrowly scoped writes: `pods` (`delete`), `deployments` & `deployments/scale` (`get`, `patch`, `update`), `replicasets` (`get`, `list`), and authorized resource `create`/`delete` (for undo/apply). **Never `cluster-admin`.** |

---

## 4. Kubernetes Compatibility Matrix

No environment may be advertised as supported until passing live integration validation in Step 7:

| Environment | Connection Modes | Required Live Validation | Special Considerations |
| :--- | :--- | :--- | :--- |
| **Minikube / Kind** | Direct + Agent | Discovery, logs, metrics, operations | Explicit CA data in kubeconfig or `CA_CERT_PEM`; zero `Insecure=true`. |
| **K3s** | Direct + Agent | Discovery, logs, metrics, operations | Host K3s kubeconfig / in-cluster Agent; Traefik/local-path storage discovery. |
| **AWS EKS** | Direct (`aws-eks-sts`) + Agent | Auth, discovery, logs, metrics, operations | In-process STS `k8s-aws-v1` token (Direct) or out-of-the-box Agent `ServiceAccount`. |
| **AKS / GKE** | Controlled Auth Adapter + Agent | Auth and observability (discovery, logs, metrics) | Entra ID / GCP OAuth in-process adapters (Direct) or outbound Agent. |
| **OpenShift** | Agent initially | RBAC (`SecurityContextConstraints`) & API compatibility | Non-root `UID 10001` container (`Dockerfile`), restricted SCC, optional namespace-scoped RBAC. |
| **Restricted-RBAC Cluster** | Agent (Read-Only / Namespace-scoped) | Graceful 5-state capability degradation | Zero `WaitForCacheSync` hangs on 403; explicit `permission_denied` badges. |

---

## 5. Execution Order, Exit Gates & Release Acceptance Criteria

### 5.1 Ordered Execution Sequence
1. **Finalize and commit the four specifications** *(current step)*.
2. **Fix critical security and tenant-isolation defects** (`SEC-C1`..`SEC-C6`, `SEC-H1`..`SEC-H6`).
3. **Implement unified execution abstraction and capability-aware discovery** (`ClusterExecutor`, `DirectExecutor`, `AgentExecutor`, `ClusterCapabilityRegistry`, SSAR + non-blocking cache sync, migrate `snapshot` + `capabilities` first).
4. **Redesign the Agent protocol** (`v2.0` handshake, header auth, session CAS, full delta reducer, multiplexed log/command framing).
5. **Deliver complete cluster discovery and observability** (Namespaces/EndpointSlices, unified `LogStreamManager`, 15s metrics pipeline + PostgreSQL `cluster_metric_samples`, honest UI states).
6. **Implement operational capabilities** (Deployment scaling, resource delete/apply/undo, PDB-checked rollbacks, durable chaos `crash`/`scale-down` lifecycle & recovery; OOM pressure remains deferred until verified).
7. **Run compatibility and production certification matrix** (Minikube, Kind, K3s, EKS, AKS/GKE, OpenShift, restricted RBAC, Profile A EC2 deploy/upgrade/rollback).

### 5.2 Mandatory Exit Gate Per Phase (All 6 Required)
1. Existing functionality must not regress (`pnpm build`, `pnpm lint`, `pnpm test`, `go test -race ./...`, `drizzle-kit check`, `testing/deployment` tests).
2. New contracts have automated unit and integration tests.
3. Direct and Agent modes are tested independently.
4. Real cluster verification passes for the phase's scope.
5. Disconnects, permission failures (403), missing APIs, and process restarts are tested with honest error reporting.
6. Known limitations and confidence levels (`Implemented`, `Unit-tested`, `Integration-tested`, `Verified on Minikube`, `Verified on Target Cloud/EKS`, `Verified in production`) are documented separately and never conflated.

### 5.3 Final Release Acceptance Matrix (Step 7)
- **16 Functional Scenarios** verified independently across **Agent** and **Direct** modes: Cluster registration, Authentication, Namespace discovery, Live topology, Resource updates, Container logs, Historical metrics (persisted across restart), Deployment scaling, Resource deletion, Resource recovery (undo), Deployment rollback, PDB validation, Pod crash experiment, Chaos cleanup, Agent/API reconnection, Workspace isolation.
- **9 Failure-Injection Scenarios**: Kill Agent during command execution; Restart `k8s-streamer`; Restart `api-server`; Interrupt WebSocket connectivity; Delete workload during log streaming; Attempt unauthorized (`VIEWER` / cross-tenant) operation; Exhaust PDB disruption allowance; Interrupt chaos experiment before cleanup; Roll back an unsuccessful deployment. Every failure must report accurate state rather than synthetic success.
