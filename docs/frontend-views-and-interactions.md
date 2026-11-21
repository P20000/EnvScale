# Frontend Views, Node Boundaries, Canvas Interactions & Settings

> **Document Scope:** Frontend user-facing views, application shell & multi-account session switcher, complete React Flow custom node/edge catalog, Material Design 3 UI primitive library, Node Boundary containers, keyboard undo/redo & deletion, Settings tabs, Incidents, Leaderboard, and Scroll-Driven Landing Page.
> **Primary Modules:** [`apps/web/src/components/`](../apps/web/src/components), [`apps/web/src/utils/nodeBoundaryHelpers.ts`](../apps/web/src/utils/nodeBoundaryHelpers.ts), [`apps/web/src/hooks/useKeyboardShortcuts.ts`](../apps/web/src/hooks/useKeyboardShortcuts.ts), [`apps/k8s-streamer/pkg/server/routes_resource.go`](../apps/k8s-streamer/pkg/server/routes_resource.go)

---

## 1. Physical Kubernetes Node Boundary Containers

Implemented in [`nodeBoundaryHelpers.ts`](../apps/web/src/utils/nodeBoundaryHelpers.ts) and [`K8sNodeBoundary.tsx`](../apps/web/src/components/canvas/K8sNodeBoundary.tsx):

- **Cloud Metadata Extraction (`extractNodeMetadata`):** Reads standard Kubernetes labels to extract:
  - **Zone:** `topology.kubernetes.io/zone`, `failure-domain.beta.kubernetes.io/zone`, or `topology.eks.amazonaws.com/zone`.
  - **Region:** `topology.kubernetes.io/region` or `failure-domain.beta.kubernetes.io/region`.
  - **Instance Type:** `node.kubernetes.io/instance-type`, `beta.kubernetes.io/instance-type`, or `instance-type`.
  - **Role:** `control-plane` (`node-role.kubernetes.io/control-plane` / `master`) or `worker`.
- **Dynamic Bounding Calculation (`calculateNodeBoundaries`):** Groups scheduled `k8sGroup`, `k8sStatefulSet`, `k8sPod`, and PVC canvas nodes by `nodeName` and constructs background container boxes (`zIndex: -1`, `PADDING_X: 28`, `PADDING_TOP: 52`, `PADDING_BOTTOM: 24`).
- **Interactive Host Highlighting:** Hovering a node boundary header sets `hoveredNodeName` in `useUIStore`; [`K8sGroup.tsx`](../apps/web/src/components/canvas/K8sGroup.tsx#L59-L61) dims unrelated workloads (`opacity-35`) and highlights hosted workloads with an emerald ring. Clicking the header selects the node in `InspectorDrawer`.
- **Workload Host Badges (`getWorkloadNodePlacement`):** Workload cards render `<nodeName>` (via `formatNodeName`, stripping `.compute.internal`/`.ec2.internal` suffixes) or `HA: <N> NODES` when replicas span multiple hosts.

---

## 2. Canvas Keyboard Shortcuts, Undo/Redo & Physical Resource Deletion

- **Keyboard Undo/Redo ([`useKeyboardShortcuts.ts`](../apps/web/src/hooks/useKeyboardShortcuts.ts)):**
  - Listens globally for `Ctrl+Z` / `Cmd+Z` (`undoAction`) and `Ctrl+Y` / `Cmd+Shift+Z` (`redoAction`), safely bypassing events when focus is inside `INPUT`, `TEXTAREA`, or `contentEditable` elements.
- **Deletion Confirmation UI ([`DeleteConfirmationModal.tsx`](../apps/web/src/components/modals/DeleteConfirmationModal.tsx)):**
  - Distinguishes individual managed `Pod` deletions from standalone resources: offers **Restart Pod Only** (reschedules the pod) vs. **Delete Entire Workload (`parentWorkloadName`)** (stops all replicas), or standard confirmation for non-pod resources.
- **Physical Kubernetes Deletion Endpoint ([`routes_resource.go`](../apps/k8s-streamer/pkg/server/routes_resource.go)):**
  - `DELETE` or `POST /api/v1/resource/delete` enforces `websocket.AuthenticateRequest(r)` and `websocket.CheckClusterAuthorization(claims, req.ClusterID)`.
  - Executes live `client-go` deletion across `Pod`, `Service`, `Deployment`, `StatefulSet`, `ReplicaSet`, and `Ingress` resources.

---

## 3. Workspace & Infrastructure Settings Suite

[`SettingsView.tsx`](../apps/web/src/components/views/SettingsView.tsx) organizes workspace administration into four tabs:

| Tab | Component | Capabilities |
| :--- | :--- | :--- |
| **Clusters & Vault** | [`ClustersVaultTab.tsx`](../apps/web/src/components/settings/ClustersVaultTab.tsx) | Displays AES-256-GCM vault status banner, registered clusters with live WS state/latency (`ms`), active target switching, `+ Connect Cluster` trigger, and cluster disconnection. |
| **Outbound Webhooks** | [`WebhooksTab.tsx`](../apps/web/src/components/settings/WebhooksTab.tsx) | Configures Slack/Discord/HTTP webhook URLs in `useUIStore`, toggles `Only dispatch CRITICAL severity incidents`, previews JSON webhook payloads, and fires a live `Send Test Alert` POST request. |
| **Stream & Canvas Tuning** | [`PreferencesTab.tsx`](../apps/web/src/components/settings/PreferencesTab.tsx) | Configures **Live Pod Log Terminal Depth** (`250`, `500`, or `1000` lines) and toggles the **System Namespaces Canvas Filter** (`kube-system`, `kube-public`, `ingress-nginx`). |
| **Gateway Access Tokens** | [`TokensTab.tsx`](../apps/web/src/components/settings/TokensTab.tsx) | Generates named `envscale_<32-hex>` bearer tokens in `useTopologyStore`, copies tokens to clipboard, and revokes existing tokens. |

---

## 4. Incidents, Alert Rule Builder & Leaderboard Views

### Incidents & Alert Policies ([`IncidentsView.tsx`](../apps/web/src/components/views/IncidentsView.tsx))
- **Incident History Sub-Tab ([`IncidentTable.tsx`](../apps/web/src/components/incidents/IncidentTable.tsx) & [`IncidentSeverityCell.tsx`](../apps/web/src/components/incidents/IncidentSeverityCell.tsx)):**
  - Synthesizes deduplicated incidents from live `k8sEvents` and unhealthy/restarting pods.
  - Renders 3 summary cards (`Triggered Incidents`, `Cluster Availability`, `Mean Time to Resolve`), severity/status/cluster filters, filter-reset controls, and distinct `EmptyState` views for healthy clusters vs. zero filter matches.
- **Alert Rules Sub-Tab ([`AlertRuleList.tsx`](../apps/web/src/components/alerts/AlertRuleList.tsx), [`AlertRuleModal.tsx`](../apps/web/src/components/alerts/AlertRuleModal.tsx), [`AlertRuleBuilder.tsx`](../apps/web/src/components/alerts/AlertRuleBuilder.tsx)):**
  - Supports creating, editing, toggling (`Active`/`Paused`), and deleting rules for `CPU Usage (%)`, `Memory Usage (%)`, and `Pod Crash / Restart (restarts)` across operators (`>`, `<`, `>=`, `<=`), durations (`Immediately` up to `30 minutes`), severities (`INFO`, `WARNING`, `CRITICAL`), and namespace scopes (`All Namespaces` or specific).
  - Includes a **Dynamic Live Preview** banner translating form selections into a readable trigger sentence.

### Gamified Leaderboard ([`LeaderboardView.tsx`](../apps/web/src/components/views/LeaderboardView.tsx))
- **Cluster Rankings Tab:** Ranks clusters descending by Health Score (`0–100`), showing dual CPU/RAM load bars, workload health, active alerts, and governance badges (`Healthy`, `Warning`, `Critical`).
- **Team Members Tab:** Displays authenticated account/member rank badges, governance point totals, and zero-downtime streaks (paired with [`leaderboard.service.ts`](../apps/api-server/src/services/leaderboard.service.ts) on the backend).

---

## 5. Scroll-Driven Landing Page & Storyline

Implemented under [`apps/web/src/components/landing/`](../apps/web/src/components/landing) using a light slate theme (`bg-slate-50`) matching the showcase video:

1. **[`LandingPage.tsx`](../apps/web/src/components/landing/LandingPage.tsx):** Composes `LandingVideoHero`, `ScrollStoryline`, and `LandingScrollFooter`.
2. **[`LandingVideoHero.tsx`](../apps/web/src/components/landing/LandingVideoHero.tsx):** Renders [`LandingTopologyMotion.tsx`](../apps/web/src/components/landing/LandingTopologyMotion.tsx), ambient [`LandingMandala.tsx`](../apps/web/src/components/landing/LandingMandala.tsx) SVG watermarks, the centered `EnvScaleLogo` (`ENVSCALE`), and the **Get Started** CTA.
3. **[`ScrollStoryline.tsx`](../apps/web/src/components/landing/ScrollStoryline.tsx) & [`landingStages.ts`](../apps/web/src/components/landing/landingStages.ts):** Embeds `/gemini_generated_video.mp4` and uses `IntersectionObserver` to reveal four alternating [`LandingStageCard`](../apps/web/src/components/landing/LandingStageCard.tsx) + [`LandingStageInfo`](../apps/web/src/components/landing/LandingStageInfo.tsx) stages:
   - `01` **The Hidden Blind Spot** (Polling gaps vs continuous watches)
   - `02` **Real-Time Live Stream** (`< 0.2 Sec` Informer & WebSocket deltas)
   - `03` **Simple System Health** (`0 - 100 Pts` Cluster Health Index & streaks)
   - `04` **Bank-Grade Safety** (AES-256 encryption, RBAC, and self-healing reconcilers)

---

## 6. Application Shell, Navigation & Multi-Account Session Switcher

- **Top Navigation Capsule ([`TopNavbar.tsx`](../apps/web/src/components/layout/TopNavbar.tsx)):**
  - **Left Header:** `ENVSCALE` brand lockup backed by a clipped spinning SVG mandala watermark.
  - **Center Capsule Cluster Controls:** Active cluster dropdown (with hover delete trigger and confirmation modal invoking `apiDisconnectCluster` + optimistic store removal), live WebSocket indicator (`CONNECTED` / `RECONNECTING` / `CONNECTING` / `DISCONNECTED`), [`NamespaceFilterPill.tsx`](../apps/web/src/components/layout/NamespaceFilterPill.tsx), and clickable Cluster Health Score pill (`score/100 • Grade A–F`) navigating directly to `leaderboard`.
  - **Right Action Controls:** Notification bell popover with unread count badge, `Mark all read`, `Clear all`, and per-item read toggling.
- **Left Icon Rail ([`LeftSidebar.tsx`](../apps/web/src/components/layout/LeftSidebar.tsx)):** Fixed `56px` (`w-14`) vertical navigation bar switching between `topology`, `logs`, `incidents` (with live badge count), `metrics`, `leaderboard`, and `settings`, plus the bottom avatar flyout button.
- **Multi-Account Profile Flyout & Auth Flows ([`UserProfileMenu.tsx`](../apps/web/src/components/layout/UserProfileMenu.tsx), [`AuthModal.tsx`](../apps/web/src/components/layout/AuthModal.tsx), [`AuthBufferPage.tsx`](../apps/web/src/components/auth/AuthBufferPage.tsx), [`WorkspaceModal.tsx`](../apps/web/src/components/layout/WorkspaceModal.tsx)):**
  - Groups saved browser sessions dynamically by medium (`Google Accounts`, `GitHub Accounts`, `Standard Login Sessions` — hiding unused groups), supports 1-click session switching (`switchAccount`), single-account sign-out vs `Sign out of all accounts`, Google/GitHub Better Auth OAuth redirects with `envscale_pending_oauth` tracking, and workspace creation.

---

## 7. Complete React Flow Node & Edge Catalog (`apps/web/src/components/canvas/` & `flow/`)

[`TopologyCanvas.tsx`](../apps/web/src/components/flow/TopologyCanvas.tsx) registers `13` custom node components across `15` `nodeTypes` keys and `2` edge renderers, accompanied by a top-right floating action capsule (`Vertical` / `Horizontal` toggle, `Auto Layout` with `Reset` chip when custom positions exist, `Recenter View` `fitView`, `Storage Visible`, `Node Boxes`, and `Show/Hide Done Jobs` counter):

| Registered `nodeTypes` Key(s) | Component | Visual Role & Badges |
| :--- | :--- | :--- |
| `k8sIngress` | [`K8sIngressNode`](../apps/web/src/components/canvas/K8sIngress.tsx) | Tier-0 ingress card (`260x56px`) with rule count chip & ingress class/host subtitle. |
| `k8sService` | [`K8sServiceNode`](../apps/web/src/components/canvas/K8sService.tsx) | Tier-1 router card (`260x56px`); switches to cyan `HEADLESS (DIRECT DNS)` styling when `clusterIP === "None"`. |
| `k8sGroup` | [`K8sGroupNode`](../apps/web/src/components/canvas/K8sGroup.tsx) | Primary workload card (`HPA`, `Shield`, `PDB`, `QUOTA`, `SA`, probe, rollout, chaos, Config/Secret, and host placement chips). |
| `k8sStatefulSet` | [`K8sStatefulSetNode`](../apps/web/src/components/canvas/K8sStatefulSet.tsx) | Expandable StatefulSet infrastructure board with ordinal blades & 1:1 PVC affinity. |
| `k8sDeployment`, `k8sReplicaSet`, `k8sWorkload` | [`K8sWorkloadNode`](../apps/web/src/components/canvas/K8sWorkload.tsx) | Compact (`260x44px`) workload/RS card displaying rolling revision hash transitions (`RS-old -> new`) or `Standalone RS`. |
| `k8sPod` | [`K8sPodNode`](../apps/web/src/components/canvas/K8sPod.tsx) | Pod pill (`208x32px`) with `CP`, `PVC`, `SA`, restart (`↺`), `DRAINING`, and `CHAOS` / `OOM` / `CRASH` indicators. |
| `k8sWorker` | [`K8sWorkerNode`](../apps/web/src/components/canvas/K8sNode.tsx) | Host node card (`260x56px`) showing status badge, CPU%, and resident DaemonSet agent count (`N DS`). |
| `k8sNodeBoundary` | [`K8sNodeBoundaryNode`](../apps/web/src/components/canvas/K8sNodeBoundary.tsx) | Background (`zIndex: -1`) physical node bounding box with zone/instance metadata. |
| `k8sPVC` | [`K8sPVCNode`](../apps/web/src/components/canvas/K8sPVC.tsx) | Tier-3 storage card showing `Bound`/`Pending`/`Lost`, capacity, mode, clone tag, and snapshots. |
| `k8sDaemonSet`, `k8sCronJob`, `k8sJob`, `k8sCompletedJobs` | [`K8sDaemonSet`](../apps/web/src/components/canvas/K8sDaemonSet.tsx), [`K8sCronJob`](../apps/web/src/components/canvas/K8sCronJob.tsx), [`K8sJob`](../apps/web/src/components/canvas/K8sJob.tsx), [`K8sCompletedJobsNode`](../apps/web/src/components/canvas/K8sCompletedJobsNode.tsx) | Side-rail infrastructure & batch dock cards. |

- **Custom Edges ([`K8sEdge.tsx`](../apps/web/src/components/canvas/K8sEdge.tsx) & [`ArgoEdge.tsx`](../apps/web/src/components/flow/ArgoEdge.tsx)):** `K8sEdge` (also aliased to `argo` in `TopologyCanvas.tsx`) supports selection blast-radius dimming (non-connected edges drop to `opacity: 0.15`), dashed `4 4` draining strokes, and zoom-scaled cubic Bezier peer-dependency arcs (`e-dep-*`) routed into parallel lanes below workloads (`TB`) or in the right channel (`LR`). `ArgoEdge` provides a smooth-step fallback renderer with inline badge labels.

---

## 8. Global Error Boundary & M3 UI Primitive Kit (`apps/web/src/components/ui/`)

- **[`ErrorBoundary.tsx`](../apps/web/src/components/ErrorBoundary.tsx):** Catches unhandled React tree crashes (`getDerivedStateFromError`), logs diagnostics, and renders an accessible M3 `role="alert"` recovery card with a **Try again** state reset button.
- **[`ToastContainer.tsx`](../apps/web/src/components/ui/ToastContainer.tsx) & [`toast.tsx`](../apps/web/src/components/ui/toast.tsx):** Enforces Material Design 3's 2-snackbar display cap (`+{hiddenCount} more alerts` pill with `Dismiss all`), pauses/resumes timers on hover, and provides 5 CVA variants (`default`, `success`, `error`, `warning`, `info`).
- **Core UI Primitives:** [`button.tsx`](../apps/web/src/components/ui/button.tsx) (`@base-ui/react/button` + 6 variants / 8 sizes), [`modal.tsx`](../apps/web/src/components/ui/modal.tsx) (body scroll lock + `Escape` dismissal), [`badge.tsx`](../apps/web/src/components/ui/badge.tsx), [`card.tsx`](../apps/web/src/components/ui/card.tsx), and [`empty-state.tsx`](../apps/web/src/components/ui/empty-state.tsx).
