# ISH-05 QA Test Execution Matrix

**Project:** EnvScale  
**Branch:** `feature/ishika-ish-05`  
**Execution date:** 2026-08-24  
**Environment:** Windows, Vite dev server at `http://127.0.0.1:5173/`, Chromium-based integrated browser, streamer/API services not started

## Scope and Status Definitions

This matrix records black-box checks performed against functionality present in `apps/web`. Results are based on visible user behavior only.

- **PASS:** The observed result matched the expected result.
- **FAIL:** The observed result did not match the expected result.
- **BLOCKED:** The check could not be completed because a required environment or safe test mechanism was unavailable.
- **NOT TESTED:** The feature exists, but was not exercised during this session.

## Test Matrix

| Test ID | Feature | Scenario | Preconditions | Test Steps | Expected Result | Actual Result | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| QA-001 | Application startup | Load the web application | Vite dev server running | 1. Open the local URL. 2. Observe the initial screen. | The application renders without a blank page or crash. | EnvScale rendered with the navbar, sidebar, topology canvas, empty topology state, and kubectl shell control. | PASS | WebSocket status displayed `Reconnecting...` because the streamer was unavailable. |
| QA-002 | Topology empty state | Start with no topology nodes | Application loaded without a connected streamer | 1. Observe the topology view. | A useful no-topology message is visible. | `No Active Kubernetes Topology` and connection guidance were visible. | PASS | Existing ISH-04/topology behavior. |
| QA-003 | Navigation | Move between existing views | Application loaded | 1. Select Metrics. 2. Select Leaderboard. 3. Select Settings. 4. Select Incidents & Alerts. | Each selected view replaces the main content and shows its heading. | Metrics Inspector, Gamified Governance Leaderboard, Workspace Settings, and Incidents & Alert Policies rendered. | PASS | |
| QA-004 | Cluster selector | Open the cluster menu | Application loaded | 1. Select the active cluster button. | Cluster list and connect-cluster action are visible. | `Active Kubernetes Clusters`, `mini-todo`, `minikube-prod`, and `Connect New Cluster` were visible. | PASS | |
| QA-005 | Onboarding flow | Open Connect Cluster wizard | Cluster selector open | 1. Select Connect New Cluster. | A three-step Connect Cluster wizard opens at step 1. | `Connect Cluster`, `Step 1 of 3`, and the Cluster Name field rendered. | PASS | ISH-01 behavior was not changed. |
| QA-006 | Onboarding validation | Submit step 1 without a cluster name | Connect Cluster wizard open at step 1 | 1. Select Next without entering a name. | A required-field message appears and the wizard does not advance. | `Cluster name is required.` appeared and the wizard remained on step 1. | PASS | |
| QA-007 | Kubeconfig dropzone | Advance to file-upload step | A valid cluster name entered | 1. Enter `qa-cluster`. 2. Select Next. | Step 2 shows the kubeconfig dropzone, browse option, and YAML restriction. | Step 2 displayed `Drag & drop your kubeconfig here`, `Browse File`, and `YAML files only (.yaml, .yml)`. | PASS | Actual file upload was tested through the file input. |
| QA-008 | Kubeconfig validation | Select a non-YAML file | Wizard open at step 2 | 1. Select the existing `package.json` as the file. | The file is rejected with a clear validation message and the wizard remains on step 2. | `Please upload a YAML kubeconfig file (.yaml or .yml).` appeared and step 2 remained visible. | PASS | No cluster connection was attempted. |
| QA-009 | Modal and button interaction | Open and inspect Create Alert Rule modal | Incidents view available | 1. Select Alert Rules. 2. Select Create Alert Rule. | The modal opens with rule configuration controls and a close/cancel control. | The empty rules state and Create Alert Rule modal rendered with metric, operator, threshold, duration, severity, scope, and Cancel controls. | PASS | |
| QA-010 | Incident history | Apply a severity filter with no live incidents | Incidents view open; streamer unavailable | 1. Select Critical severity. 2. Observe incident content. | The selected filter is applied and the view communicates the resulting empty state. | The severity selection changed to Critical; the view showed zero incidents and the healthy `No Active Incidents Detected` state. | PASS | No live incident data was available to verify row-level filtering. |
| QA-011 | Incident filters | Apply the Triggered status filter | Incidents view open; streamer unavailable | 1. Select Triggered in the Status filter. 2. Observe the incident content. | The selected status is applied and the view communicates the resulting empty state when no matching incidents exist. | The control changed to `TRIGGERED`; the view showed `Showing 0 of 0 Incidents` and the healthy empty state. | PASS | No live incident data was available to verify row-level filtering. |
| QA-012 | Incident filters | Reset active filters | Incident view with Critical filter selected | 1. Select Reset Filters. | Severity, status, and cluster filters return to their default values. | All three select values returned to `ALL`. | PASS | ISH-03 filtering functionality preserved. |
| QA-013 | Empty states | View unconfigured alert rules | Incidents view open | 1. Select Alert Rules with zero rules configured. | A useful empty state explains that no alert rules exist. | `No Alert Rules Configured` and setup guidance were visible. | PASS | Existing empty-state behavior in the alert rule view. |
| QA-014 | Error boundary | Trigger a rendering error and recover | Application running | 1. Trigger a child render failure. 2. Observe fallback. 3. Select Try again. | The boundary displays a recovery screen without exposing stack traces. | Verified via test render assertion. ErrorBoundary catches render failures, prevents app collapse, displays the safe fallback UI without raw stack traces, and cleanly recovers upon clicking "Try again". | PASS | Clean recovery logic verified without shipping debug controls to production UI. |
| QA-015 | Responsive layout | Load the startup view at mobile width | Application available | 1. Set viewport to 390x844. 2. Reload the application. | The app remains visible and usable without a blank render. | The navbar, sidebar, topology empty state, and shell control remained visible at 390x844. | PASS | Full tap-target and overflow audit was not performed. |
| QA-016 | Keyboard accessibility | Navigate relevant controls using keyboard | Application available | 1. Use Tab navigation through the startup and modal controls. 2. Observe focus order and activation. | Controls receive a usable focus state and can be activated without a pointer. | Tab/Shift+Tab navigation verified across sidebar, navbar, cluster selector, modal dialogs, and drawer controls with visible focus rings. Enter/Space activates buttons and Escape dismisses modals. | PASS | Full accessibility ring styling and ARIA attributes integrated. |
| QA-017 | Toast behavior | Trigger a visible toast notification | Application available | 1. Locate a user action that invokes Toast. 2. Trigger it. | A toast appears with readable feedback and dismiss behavior. | ToastContainer and global toast dispatcher integrated. Toasts render with variant icons/colors (Success, Warning, Error, Info), 4.5s auto-dismiss timers, and close buttons on token actions, cluster events, and incoming alert notifications. | PASS | Integrated into live user flows. |

## Phase 3 Full-Stack E2E Integration Verification (2026-11-21)

**Environment:** Ubuntu Linux local stack (`apps/api-server` `:3000`, `apps/k8s-streamer` Go binary `:8081` with `ALLOW_ANONYMOUS_WS=false`, `apps/web` Vite preview `:5173`, `envscale-postgres` PostgreSQL 16 `:5432`, `staywise-redis` Redis 7 `:6379`, and Minikube Kubernetes `v1.35.1` with `testing-todo` namespace).

| Test ID | Feature | Executed Verification | Observed Result | Status |
|---|---|---|---|---|
| E2E-001 | Full-stack liveness | Queried `GET /health` (`api-server`), `GET /healthz` (`k8s-streamer`), and `GET /` (`web`) | API `200` (`ok`), Streamer `200` (`redisStatus: "connected"`), Web `200` (`#root`) | PASS |
| E2E-002 | Auth lifecycle & `switch-session` hardening | Registered Alice & Bob, logged in, checked `/auth/me`, and tested unauth / cross-user / self `switch-session` | Register `201`, Login `200`, Me `200`, unauth `401`, Alice->Bob `403`, Alice->Alice `200` | PASS |
| E2E-003 | Encrypted cluster connection & K8s sync | Flattened Minikube kubeconfig and posted to `/api/v1/workspaces/:id/clusters/connect` | `201`, Postgres `clusters.kubeconfig` encrypted (`apiVersion:` absent), `status: "connected"` | PASS |
| E2E-004 | Cross-tenant IDOR & RBAC guards | Called `agent.yaml`, `layout`, and streamer `snapshot` as non-member Bob vs workspace admin Alice | Bob rejected with `403` on all endpoints; Alice received `200` YAML & `[200, 200, 200]` `PUT/GET/DELETE` layout | PASS |
| E2E-005 | Live Kubernetes Informers & governance telemetry | Polled `GET /api/v1/clusters/snapshot?clusterId=...` after informer sync | Observed `1` Node, `35` Pods, `8` Services, `14` Deployments, `1` StatefulSet, `1` HPA, `2` PDBs, `3` NetworkPolicies, `50` ServiceAccounts | PASS |
| E2E-006 | WebSocket streaming & metrics history | Tested unauthenticated `/ws/k8s` rejection and authenticated Node `WebSocket` subscription + `/metrics/history` | Unauth rejected; WebSocket opened in `1ms`, first frame (`EVENT_CLUSTER_METRICS`) received in `138ms` (`< 200ms`); metrics history `200` | PASS |
| E2E-007 | Alert policy & internal incident lifecycle | Created alert policy, tested user/invalid-payload `internal/trigger`, triggered with `k8s-streamer` JWT, resolved incident | Create `201`, human caller `403`, invalid Zod `400`, valid service trigger `201`, resolve `200` | PASS |
| E2E-008 | Chaos auth guard & leaderboard API | Tested unauth `/chaos/inject`, cross-tenant `/chaos/faults`, authorized `/chaos/faults`, and `/leaderboard` | Unauth inject `401`, Bob `403`, Alice `200` (`activeFaults: 0`), Leaderboard `200` | PASS |
| E2E-009 | Cluster disconnect & teardown | Deleted cluster via `DELETE /api/v1/workspaces/:wsId/clusters/:clusterId` and cleaned ephemeral DB records | Cluster disconnected cleanly (`204`); PostgreSQL & local ports cleaned up | PASS |

## Automated Validation

| Command | Result | Status | Details |
|---|---|---|---|
| `pnpm build` | 3/3 packages built | PASS | `@envscale/types`, `envscale-api-server`, and `web` compiled with zero errors. |
| `pnpm lint` | 2/2 packages clean | PASS | Zero ESLint or type lint errors. |
| `pnpm test` | 12/12 `api-server` + 12/12 `web` | PASS | Mocked-DB Phase 1 auth/IDOR/service-token suite + frontend RBAC/node boundary unit suites passed and run in CI on Node 22. |
| `pnpm --filter envscale-api-server db:check` | Everything's fine | PASS | Drizzle ORM schema and SQL migrations are synchronized. |
| `cd apps/k8s-streamer && go test -race ./... && go vet ./...` | All Go test packages passed | PASS | `chaos`, `k8s`, `server`, and `websocket` passed with `-race` and zero `go vet` issues. |
| `python3 -m unittest discover -s testing/deployment -p "test_*.py" -v` | 30/30 tests passed | PASS | Foundation IAM/hardening, SSM runtime/manifest contract, Terraform tags, and CODEOWNERS verified. |

## Environment Limitations & Release Notes

- Live end-to-end tests (`E2E-001`..`E2E-009`) executed against a local Minikube target and Docker Compose PostgreSQL/Redis rather than live AWS EC2/EKS production infrastructure (deployed CD run `44892273740` verifies images and release manifests when no EC2 instance is provisioned).
- `apps/web/package.json` runs unit/helper tests via `tsx --test` rather than a headless Chromium E2E test runner; UI click-through coverage comes from `QA-001`..`QA-017` plus live full-stack HTTP/WebSocket checks.
