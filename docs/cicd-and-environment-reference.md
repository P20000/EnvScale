# CI/CD Pipelines, Release Manifest Guards & Environment Reference

> **Document Scope:** GitHub Actions CI/CD and Foundation workflows, immutable digest-pinned release manifests, host runtime safety guards, SSM secret synchronization, and the complete monorepo environment variable matrix.
> **Primary Modules:** [`.github/workflows/`](../.github/workflows), [`deployment/scripts/`](../deployment/scripts), [`deployment/runtime.env.example`](../deployment/runtime.env.example), [`apps/api-server/src/config/env.ts`](../apps/api-server/src/config/env.ts)

---

## 1. GitHub Actions Workflows (`.github/workflows/`)

### CI Pipeline ([`ci.yml`](../.github/workflows/ci.yml))
Triggered on pushes to `main`, `develop`, `feature/**` and pull requests targeting `main` or `develop` with per-ref concurrency cancellation:

| Job | Runner / Runtime | Executed Verification Steps |
| :--- | :--- | :--- |
| **`typescript-monorepo`** | Ubuntu + Node 20 + pnpm | `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm test` (`api-server` security/RBAC & `web` helper suites), `pnpm --filter envscale-api-server db:check` (Drizzle Kit check). |
| **`k8s-streamer-engine`** | Ubuntu + Go `1.24` | `go mod verify`, `go test -v -race ./...`, `CGO_ENABLED=0 go build -v -ldflags="-w -s" -o /dev/null ./cmd/server`. |
| **`db-schema-check`** | Ubuntu + Node 20 + pnpm | Installs `envscale-api-server...` workspace deps and asserts `src/db/migrations` existence. |
| **`deployment-contract-checks`** | Ubuntu + Python `3.12` | Runs `validate-release-manifest.py --manifest deployment/release/release-manifest.example.json --allow-example` and `python3 -m unittest discover -s testing/deployment -p "test_*.py" -v`. |

### CD Pipeline ([`cd.yml`](../.github/workflows/cd.yml))
Triggered on pushes to `develop` (ignoring `deployment/terraform/**`, `docs/**`, `**.md`) or `workflow_dispatch` (with optional `force_deploy_gate` boolean input):
1. **`build-and-push` (Matrix: `api-server`, `k8s-streamer`, `web`):** Builds `linux/amd64` Docker images with GHA buildx cache (passing `VITE_API_BASE_URL=`, `VITE_STREAMER_BASE_URL=`, `VITE_WS_URL=/ws/k8s` for `web`), pushes `ghcr.io/<owner>/envscale-{api-server,k8s-streamer,web}:sha-<commit_sha>`, and uploads immutable `@sha256:...` digest artifacts.
2. **`generate-manifest`:** Downloads image digests, runs `generate-release-manifest.py` + `validate-release-manifest.py --verify-repo-migrations`, uploads `release-manifest.json` (`30d` retention), and (when `AWS_RELEASE_ROLE_ARN` + `RECOVERY_BUCKET` are set) assumes AWS OIDC credentials to upload `s3://<RECOVERY_BUCKET>/releases/<commit_sha>/release-manifest.json`.
3. **`check-deploy-target`:** Pre-flight job (without `environment: production`) checks whether repo-level `EC2_INSTANCE_ID` (`secrets.EC2_INSTANCE_ID || vars.EC2_INSTANCE_ID`) is configured or `workflow_dispatch` set `force_deploy_gate=true`, emitting `ec2_configured` (`true` or `false`) and a diagnostic `reason`.
4. **`deploy` (`production` environment, gated on `ec2_configured == 'true'`):** Assumes `AWS_DEPLOY_ROLE_ARN`, runs `aws ec2 describe-instances` to verify the target EC2 host is in `running` state, base64-encodes `release-manifest.json`, and dispatches exact-SHA `git checkout --detach` + `sync-ssm-secrets.py` + `envscale.sh deploy --manifest` on `EC2_INSTANCE_ID` via `aws ssm send-command`.
5. **`deploy-fallback-summary` (gated on `ec2_configured != 'true'`):** Downloads the validated `release-manifest` artifact and writes a release readiness summary to `$GITHUB_STEP_SUMMARY` so CD completes cleanly without hanging at the manual `production` approval gate when no EC2 host is provisioned.

### Foundation Pipeline ([`foundation.yml`](../.github/workflows/foundation.yml))
Manual `workflow_dispatch` for Day-0/Day-2 AWS IAM/S3/VPC provisioning on `develop` or `main` using pinned Terraform `1.14.9` and serialized concurrency locks:
- **`plan` Job (`foundation-plan` environment, Read-Only OIDC `AWS_FOUNDATION_PLAN_ROLE_ARN`):** Runs `foundation_workflow_guard.py` (`check-branch`, `check-concurrency`), `day0_identity_guard.py check-policies`, `validate-foundation-plan.py --self-test`, checks S3 state fingerprint (`ETag|VersionId`) before and after `terraform plan -lock=false` to reject concurrent drift, validates `tfplan.json` against the allowlist (`auto`, `initial`, `update`), writes `SHA256SUMS` + `plan-attestation.json`, and uploads the plan artifact.
- **`apply` Job (`foundation` Protected Environment, `AWS_FOUNDATION_ROLE_ARN`):** Runs only when `action == 'plan-and-apply'`, `apply_confirmation == 'APPLY-FOUNDATION'`, and `has_changes == 'true'`. Re-verifies plan attestation and S3 state fingerprint (`verify-attestation`), executes `terraform apply -input=false -auto-approve tfplan.bin`, and enforces post-apply idempotency (`terraform plan -detailed-exitcode` expecting exit code `0`).

---

## 2. Release Manifest & Host Runtime Scripts (`deployment/scripts/`)

| Script | Responsibility & Safety Invariants |
| :--- | :--- |
| **[`generate-release-manifest.py`](../deployment/scripts/generate-release-manifest.py)** | Builds atomic `release-manifest.json` (`rel-<timestamp>-<sha8>`) binding Git commit SHA, `@sha256:` pinned GHCR image refs, and Drizzle migration bundle SHA-256 against `release-schema.json`. |
| **[`validate-release-manifest.py`](../deployment/scripts/validate-release-manifest.py)** | Zero-dependency validator auditing schema keywords/types (including `$defs`), rejecting `manifest_kind == "example"`, `*.example.json`, floating tags (`:latest`, `:main`, `:develop`, `:master`, `:prod`, `:edge`), and synthetic digests (`< 8` distinct hex chars). Supports `--verify-repo-migrations`, `--compute-migrations-hash`, and `--emit-env`. |
| **[`runtime-guards.py`](../deployment/scripts/runtime-guards.py)** | 5 subcommands: `verify-inherited-flock` (kernel `fstat` + `LOCK_EX` FD proof), `verify-pre-deploy-backup` (`RESTORE_VERIFIED` & `VERIFIED_OPERATIONAL`, freshness `1..86400s`, byte size, `pg_custom_fc` format, SHA-256), `render-caddyfile` (strict public IPv4 & 3 distinct TCP ports `1..65535`), `verify-db-migrations` (prefix hash/timestamp & `backward_compatible_db` check on rollback), and `rotate-release-pointers`. |
| **[`sync-ssm-secrets.py`](../deployment/scripts/sync-ssm-secrets.py)** | Fetches `/envscale/prod/*` SSM Parameter Store values via IAM role with `--with-decryption` and writes escaped `KEY="VALUE"` entries atomically to `/etc/envscale/secrets.env` (`mode 0600`, refusing symlinks). |
| **[`host-runtime.sh`](../deployment/scripts/host-runtime.sh)** | Executes the 8-step cutover sequence under exclusive FD 9 `flock`: validates manifest & digests -> checks `>= 2 GiB` disk, secrets & Compose v2 -> pre-pulls 3 `@sha256` images before touching running containers -> stages/validates Caddyfile -> ensures `postgres`/`redis` healthy -> verifies pre-deploy backup proof & runs `node dist/db/migrate.js` -> promotes Caddy & `rendered.compose.env` -> runs `verify.sh` and rotates pointers (or auto-invokes `rollback.sh --from-failed-deploy --lock-fd 9`). |
| **[`rollback.sh`](../deployment/scripts/rollback.sh)** | Reverts disposable `api-server`, `k8s-streamer`, and `web` containers to `last-known-good` or `previous-known-good` without mutating `postgres` or `redis`. Fails closed if `drizzle.__drizzle_migrations` diverges or non-backward-compatible migrations exist (unless `--allow-schema-divergent-rollback`). |
| **[`verify.sh`](../deployment/scripts/verify.sh)** | Verifies all 5 Compose containers report `running:healthy`, confirms `Config.Image` and `RepoDigests` match manifest `@sha256` digests, verifies Drizzle migration hashes + all 12 canonical PostgreSQL tables, and runs HTTP/Redis/`401` unauthenticated auth smoke tests. |

---

## 3. Environment Variables Reference Matrix

### Backend API Server (`apps/api-server` — [`env.ts`](../apps/api-server/src/config/env.ts) & [`agent-manifest.service.ts`](../apps/api-server/src/services/agent-manifest.service.ts))

| Variable | Default / Required | Purpose & Validation Rules |
| :--- | :--- | :--- |
| `NODE_ENV` | `"development"` | `"development"` \| `"production"` \| `"test"`; enforces non-wildcard `CORS_ORIGIN` & non-placeholder secrets in `production`. |
| `PORT` | `3000` | Express HTTP listener port. |
| `DATABASE_URL` | Required URI | Valid PostgreSQL URL used by Drizzle ORM & `pg` pool. |
| `JWT_ACCESS_SECRET` | Required | HMAC signing key for short-lived access JWTs (must match `k8s-streamer`). |
| `JWT_REFRESH_SECRET` | Required | Separate HMAC signing key for 7-day refresh tokens. |
| `KUBECONFIG_ENCRYPTION_KEY` | Required for `direct` mode | Exact 32-byte key encoded as 44-char standard Base64 for AES-256-GCM kubeconfig encryption ([`crypto.ts`](../apps/api-server/src/utils/crypto.ts)). *(Zod schema also allows optional `ENCRYPTION_KEY`.)* |
| `CORS_ORIGIN` | `"*"` (Dev only) | Comma-separated allowed frontend origins; `production` exits `1` if `"*"`. |
| `BETTER_AUTH_SECRET` | Optional / Recommended | Session signing key for Better Auth OAuth & cookie sessions. |
| `BETTER_AUTH_URL` | `"http://localhost:3000"` | Public base URL used by Better Auth OAuth callbacks. |
| `GOOGLE_CLIENT_ID` / `SECRET` | Optional | Enables Google OAuth 2.0 login flow in Better Auth. |
| `GITHUB_CLIENT_ID` / `SECRET` | Optional | Enables GitHub OAuth login flow in Better Auth. |
| `K8S_STREAMER_URL` | `"http://localhost:8080"` | Internal base URL for `api-server -> k8s-streamer` cluster registration & sync. |
| `STREAMER_WS_URL` | Auto-resolved | Overrides agent WebSocket URL in generated `agent.yaml` (e.g. `wss://envscale.duckdns.org/ws/agent`). |
| `LOCAL_STREAMER_WS_URL` | `"ws://host.minikube.internal:8080/ws/agent"` | Default WebSocket target embedded in `agent.yaml` during local development. |
| `AGENT_IMAGE` | `"ghcr.io/p20000/envscale-k8s-streamer:latest"` | Container image rendered into the generated `envscale-agent` Deployment YAML. |

### Streaming Gateway & In-Cluster Agent (`apps/k8s-streamer` — [`main.go`](../apps/k8s-streamer/cmd/server/main.go) & [`runner.go`](../apps/k8s-streamer/pkg/agent/runner.go))

| Variable | Default / Required | Purpose |
| :--- | :--- | :--- |
| `MODE` / `ENVSCALE_MODE` | Gateway (unset) | Set to `"agent"` (or pass CLI arg `agent`) to run the outbound in-cluster agent runner instead of the HTTP gateway. |
| `PORT` | `"8080"` | Gateway HTTP/WebSocket bind port. |
| `JWT_ACCESS_SECRET` | Required in prod | HMAC verification secret shared with `api-server`. Halts startup (`log.Fatal`) in `production` / `GIN_MODE=release` if unset. |
| `ALLOW_ANONYMOUS_WS` | `"false"` (`.env.example`: `"true"`) | Dev-only flag permitting unauthenticated `/ws/*` and HTTP inspection routes when `true`. |
| `REDIS_URL` | Optional (`redis://localhost:6379`) | Enables Redis Pub/Sub multi-instance event fan-out; falls back to single-instance mode if unset. |
| `API_SERVER_URL` | Optional | Target URL for `evaluator_incident_dispatcher.go` internal incident triggers (`POST /api/v1/incidents/internal/trigger`). |
| `CORS_ORIGIN` / `ALLOWED_ORIGINS` | `"*"` fallback | Origin allowlist checked by `websocket.IsOriginAllowed`. |
| `CLUSTER_ID` / `ENVSCALE_CLUSTER_ID` | Agent mode only | Target EnvScale Cluster UUID stamped onto outbound agent WebSocket envelopes. |
| `SERVER_URL` / `ENVSCALE_SERVER_URL` | Agent mode only | Remote gateway `/ws/agent` endpoint dialed by `runner.go`. |
| `CLUSTER_TOKEN` / `ENVSCALE_TOKEN` | Agent mode only | Signed agent authentication token appended to `/ws/agent` dial query. |
| `KUBECONFIG` | Agent / CLI fallback | Path to kubeconfig when running `MODE=agent` outside an in-cluster Pod. |

### Frontend Web App (`apps/web`) & Host Production Runtime ([`runtime.env.example`](../deployment/runtime.env.example))

- **Web Build/Runtime (`apps/web/.env.example`):**
  - `VITE_API_BASE_URL` (Dev: `http://localhost:3000`; Prod image build: empty string `""` for relative reverse-proxy routing).
  - `VITE_STREAMER_BASE_URL` (Dev: `http://localhost:8080`; Prod image build: `""`).
  - `VITE_WS_URL` (Dev: `ws://localhost:8080/ws/k8s`; Prod image build: `/ws/k8s`).
  - `VITE_WS_BASE_URL` (Optional override read by [`useResourceLogs.ts`](../apps/web/src/hooks/useResourceLogs.ts) before deriving from `VITE_WS_URL`).
- **Host Runtime Contract (`/etc/envscale/secrets.env` synced from SSM `/envscale/prod/*`):**
  - Required SSM keys in `sync-ssm-secrets.py`: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `KUBECONFIG_ENCRYPTION_KEY`, `DUCKDNS_DOMAIN`, `DUCKDNS_TOKEN` (plus optional `POSTGRES_USER`, `POSTGRES_DB`, Google/GitHub OAuth pairs, `RECOVERY_BUCKET`, `AWS_REGION`, host ports `API_HOST_PORT=3001`, `STREAMER_HOST_PORT=8080`, `WEB_HOST_PORT=3000`, and `K3S_SOURCE_KUBECONFIG` / `K3S_KUBECONFIG_HOST_PATH`).

