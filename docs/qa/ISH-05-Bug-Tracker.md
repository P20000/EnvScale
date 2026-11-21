# ISH-05 Bug Tracker Log

**Project:** EnvScale  
**Branch:** `feature/ishika-ish-05`  
**QA session date:** 2026-08-24  
**Environment:** Windows, Vite dev server at `http://127.0.0.1:5173/`, Chromium-based integrated browser

## Session Result

No reproducible application bugs were found during the executed black-box QA session.

The following previously recorded environment and coverage limitations have been addressed and verified:

- Error Boundary fallback behavior has been verified with clean recovery logic (QA-014: PASS).
- Keyboard accessibility with visible focus rings and ARIA attributes is now fully integrated (QA-016: PASS).
- Global Toast notification system is now integrated with auto-dismiss timers, variant icons, and close buttons (QA-017: PASS).
- Web lint passed cleanly with zero ESLint warnings or errors (`@typescript-eslint/no-explicit-any` resolved).


## Bug Log

| Bug ID | Date Found | Feature | Title | Description | Steps to Reproduce | Expected Result | Actual Result | Severity | Priority | Status | Environment | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| None | 2026-08-24 | N/A | No reproducible bugs found | No application defect met the reproducibility requirement during this session. | N/A | N/A | N/A | N/A | N/A | VERIFIED | Windows, local Vite web app | See the QA matrix for executed coverage and environment limitations. |

## Pre-Release Security & Infrastructure Audit Log (2026-11-21)

The following pre-`main` release blockers were identified during full repository auditing, fixed in PRs `#118` and `#119`, and verified against automated tests and live Minikube full-stack E2E (`E2E-001`..`E2E-009`):

| Finding ID | Category | Issue Summary | Remediation & Verification | Severity | Status |
|---|---|---|---|---|---|
| SEC-001 | Authentication (`api-server`) | `POST /api/v1/auth/switch-session` accepted `accountId` or `email` without `requireAuth`, enabling unauthenticated session minting. | Enforced `requireAuth`, Zod `switchSessionSchema`, and strict caller identity matching (`403` on cross-user request) in PR `#118`. Verified in CI (`auth-and-tenant-security.test.ts`) and `E2E-002`. | Critical | VERIFIED |
| SEC-002 | Tenant RBAC / IDOR (`api-server`) | Cluster `GET agent.yaml` and `GET`/`PUT`/`DELETE layout` routes resolved `clusterId` globally without checking workspace membership or role permissions. | Added `requireClusterRole` middleware bound to `authorizedClusterId` and workspace RBAC roles (`ADMIN`/`MEMBER` mutations/manifest, `ADMIN`/`MEMBER`/`VIEWER` layout read) in PR `#118`. Verified in CI and `E2E-004`. | Critical | VERIFIED |
| SEC-003 | Service Authorization (`api-server`) | `POST /api/v1/incidents/internal/trigger` permitted regular authenticated users and lacked Zod payload validation. | Restricted Bearer service tokens (`isServiceToken`), added `requireServiceAuth` + `internalIncidentTriggerSchema` in PR `#118`. Verified in CI and `E2E-007`. | High | VERIFIED |
| INFRA-001 | Cloud IAM Governance (`deployment/`) | Runtime and EKS Terraform stacks lacked `Layer = "DisposableRuntime"` (and EKS lacked `Project = "EnvScale"`), causing IAM condition mismatches with `iam_cicd.tf`. | Added `default_tags` in `deployment/terraform/versions.tf` and `deployment/terraform-eks/versions.tf` plus contract assertions in PR `#119`. Verified via `test_ssm_deployment_contract.py` (`30/30`). | High | VERIFIED |
