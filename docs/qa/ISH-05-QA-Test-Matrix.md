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
| QA-014 | Error boundary | Trigger a rendering error and recover | Application running | 1. Trigger a child render failure. 2. Observe fallback. 3. Select Try again. | The boundary displays a recovery screen without exposing stack traces. | Not executed because the application has no safe user-facing error trigger and intentionally injecting a failure would modify or destabilize the app under test. | BLOCKED | Requires a dedicated test harness or approved fault-injection route. |
| QA-015 | Responsive layout | Load the startup view at mobile width | Application available | 1. Set viewport to 390x844. 2. Reload the application. | The app remains visible and usable without a blank render. | The navbar, sidebar, topology empty state, and shell control remained visible at 390x844. | PASS | Full tap-target and overflow audit was not performed. |
| QA-016 | Keyboard accessibility | Navigate relevant controls using keyboard | Application available | 1. Use Tab navigation through the startup and modal controls. 2. Observe focus order and activation. | Controls receive a usable focus state and can be activated without a pointer. | Not tested during this session. | NOT TESTED | Requires a dedicated keyboard-only pass. |
| QA-017 | Toast behavior | Trigger a visible toast notification | Application available | 1. Locate a user action that invokes Toast. 2. Trigger it. | A toast appears with readable feedback and dismiss behavior. | Not tested; the Toast primitive exists, but no visible invocation was identified in the exercised web flows. | NOT TESTED | Requires a flow that emits a toast or a dedicated test harness. |

## Automated Validation

| Command | Result | Status | Details |
|---|---|---|---|
| `pnpm --filter web exec tsc --noEmit` | Completed with no output | PASS | Web TypeScript check passed. |
| `pnpm --filter web build` | Completed successfully | PASS | Vite production build passed. It emitted a non-blocking warning about a chunk larger than 500 kB. |
| `pnpm --filter web lint` | Failed | FAIL | One existing error remains at `apps/web/src/store/useTopologyStore.ts:142`: `@typescript-eslint/no-explicit-any`. No ISH-05 files caused this error. |
| `pnpm build` | Completed successfully | PASS | All three build tasks completed successfully after dependency installation. |

## Environment Limitations

- The Vite web server was available for manual testing.
- The Kubernetes streamer was not running, so live WebSocket hydration, connected topology data, live incidents, pod inspection, and streaming logs could not be validated end to end.
- The API server was not started, so cluster persistence and backend-backed connection behavior were not validated.
- No automated browser test runner is defined in `apps/web/package.json`.
