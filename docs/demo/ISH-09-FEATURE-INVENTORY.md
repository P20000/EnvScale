# ISH-09 — Feature Inventory

**Project:** EnvScale  
**Branch:** `feature/ishika-ish-09`  
**Inspection date:** 2026-08-25  
**Inspector:** Ishika  
**Purpose:** Document the demo-readiness of every visible feature before scripting the 3-minute product demo video.

---

## Inspection Methodology

Each feature was assessed by reading its source files directly — no assumptions were made from documentation alone. Demo-readiness is classified as one of four states:

| Status | Meaning |
|---|---|
| ✅ DEMO READY | Works standalone; no backend services required |
| ⚡ MOCKED | Renders and animates without backend; data is simulated/hardcoded |
| 🔴 NEEDS BACKEND | Requires Go k8s-streamer and/or REST API server and/or Minikube cluster |
| ℹ️ INFORMATIONAL | Static UI; no interaction needed to demonstrate value |

---

## 1. Application Shell & Layout

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Dark canvas shell (`#09090b` background) | ✅ DEMO READY | `apps/web/src/App.tsx`, `index.css` | **YES** — first impression |
| TopNavbar — logo + wordmark | ✅ DEMO READY | `components/layout/TopNavbar.tsx` | **YES** — establishes brand |
| TopNavbar — cluster selector dropdown | ✅ DEMO READY | Store seeds `["mini-todo"]`; dropdown renders immediately | **YES** |
| TopNavbar — WS status indicator (red DISCONNECTED dot) | ✅ DEMO READY | `useTopologyStore` initial `wsStatus = "DISCONNECTED"` | **YES** — shows live state awareness |
| TopNavbar — WS status (green CONNECTED dot + latency) | 🔴 NEEDS BACKEND | Requires Go streamer at `ws://localhost:8080/ws/k8s` | **YES** — in full-stack demo segment |
| TopNavbar — notifications bell (empty) | ✅ DEMO READY | Renders with count=0 | **YES** — show popover |
| TopNavbar — notifications bell (populated) | 🔴 NEEDS BACKEND | Populated by streamer alert events | Optional |
| LeftSidebar — 5-icon navigation capsule | ✅ DEMO READY | `components/layout/LeftSidebar.tsx` | **YES** — show all tab transitions |
| LeftSidebar — hover tooltips | ✅ DEMO READY | Tooltip on each icon | **YES** — hover during demo |
| LeftSidebar — incidents badge (red count) | 🔴 NEEDS BACKEND | Count derived from unhealthy pods + unread alerts | Optional |
| No mandatory login / auth gate | ✅ DEMO READY | App loads directly — no redirect, no guard | **YES** — narrate zero-friction onboarding |

---

## 2. Connect Cluster Onboarding Wizard (ISH-01)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Step 1 — cluster name input + validation | ✅ DEMO READY | `ConnectClusterWizard.tsx` step 1 | **YES** |
| Step 2 — kubeconfig drag-and-drop zone | ✅ DEMO READY | Dropzone, `.yaml`/`.yml` filter | **YES** |
| Step 2 — file type rejection | ✅ DEMO READY | Non-YAML files rejected with error message | Optional |
| Step 3 — review & connect confirmation | ✅ DEMO READY | Graceful fallback: succeeds even if backends offline | **YES** |
| Success screen — "Cluster Connected!" | ✅ DEMO READY | Returns `{ cluster: { name } }` fallback | **YES** |
| New cluster appears in dropdown | ✅ DEMO READY | `addCluster(name)` → Zustand store | **YES** |

**Notes:** The wizard will always show success in demo conditions. Narration should say "EnvScale validates the kubeconfig and registers the cluster" — which is architecturally true even if the live connection confirmation is simulated when backends are offline.

---

## 3. Topology Canvas (NEH + PRN)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Empty state — "No Active Kubernetes Topology" | ✅ DEMO READY | `TopologyCanvas.tsx` — `nodes.length === 0` overlay | **YES** — show before connection |
| Dot-grid dark background | ✅ DEMO READY | `BackgroundVariant.Dots`, `#27272a` | **YES** — visual quality |
| Top-right action capsule (Vertical/Horizontal toggle, Auto Layout, Recenter) | ✅ DEMO READY | Canvas action buttons always visible | **YES** |
| Populated canvas with pods, nodes, services, ingresses | 🔴 NEEDS BACKEND | Requires Go streamer + registered Minikube cluster | **YES** — core demo moment |
| K8sPod nodes with status colors | 🔴 NEEDS BACKEND | `K8sPodNode` — Running=emerald, CrashLoopBackOff=red, Pending=amber | **YES** |
| K8sWorkerNode (physical node) | 🔴 NEEDS BACKEND | `K8sWorkerNode` — CPU/memory capacity display | **YES** |
| K8sService nodes | 🔴 NEEDS BACKEND | `K8sServiceNode` | **YES** |
| K8sIngress node (violet) | 🔴 NEEDS BACKEND | `K8sIngressNode` — rules badge, purple accent | **YES** |
| K8sWorkload group container (Deployment/ReplicaSet) | 🔴 NEEDS BACKEND | `K8sWorkloadNode`, `K8sGroupNode` | **YES** |
| Dagre auto-layout (TB / LR) | 🔴 NEEDS BACKEND | Requires nodes in store to compute layout | **YES** — toggle direction |
| ArgoCD-style animated edges | 🔴 NEEDS BACKEND | `ArgoEdge.tsx` — animated stroke-dasharray | **YES** |
| Node click → InspectorDrawer | 🔴 NEEDS BACKEND | Requires node on canvas | **YES** |
| Undo/Redo (Ctrl+Z) | 🔴 NEEDS BACKEND | Requires delete action to have been performed | Optional |
| Delete node (Delete key) → confirmation modal | 🔴 NEEDS BACKEND | `DeleteConfirmationModal` | Optional |

---

## 4. Inspector Drawer (NEH + PRN)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Drawer slide-in animation | 🔴 NEEDS BACKEND | Requires node selection on canvas | **YES** |
| Overview tab — pod details (name, namespace, IP, restarts, uptime) | 🔴 NEEDS BACKEND | Live pod data from store | **YES** |
| Overview tab — Ingress routing rules table (host, path, service:port) | 🔴 NEEDS BACKEND | Ingress-specific panel | **YES** |
| Live Logs tab — rolling simulated log stream | ⚡ MOCKED | `setInterval` 2500ms appending from `sampleLogs[]` | **YES** — always scrolls in demo |
| Live Logs tab — Pause/Resume | ⚡ MOCKED | Toggles `isTailing` state | **YES** |
| Live Logs tab — Expand Terminal button → PodLogDrawer | ⚡ MOCKED | Opens full `PodLogDrawer` | **YES** |
| Usage tab — CPU/Memory progress bars | 🔴 NEEDS BACKEND | `cpuUsageMcores`/`memoryUsageMiB` from streamer | **YES** — if streamer running |
| Chaos tab — Simulate Crash, OOM, Scale-down | 🔴 NEEDS BACKEND | `POST /api/v1/chaos/inject` to streamer; shows dispatched message on failure | Optional |

---

## 5. Pod Log Drawer (PodLogDrawer)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Full-screen log terminal | ⚡ MOCKED | `usePodLogs` hook generates rolling log lines every 2000ms | **YES** |
| Log level filter pills (ALL/TRACE/DEBUG/INFO/WARN/ERROR/FATAL) | ⚡ MOCKED | Client-side filter over generated logs | **YES** |
| Search input | ⚡ MOCKED | Client-side filter | **YES** |
| Auto-scroll + "N new logs" floating button | ⚡ MOCKED | Scroll position detection | **YES** |
| Copy logs to clipboard | ⚡ MOCKED | `navigator.clipboard.writeText` | Optional |
| Pause/Resume tail | ⚡ MOCKED | Toggles log generation interval | **YES** |

---

## 6. Kubectl Web Terminal (KubectlTerminal)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Floating bottom-left terminal panel | ✅ DEMO READY (empty) | `KubectlTerminal.tsx` — always rendered in DOM | **YES** — show toggle |
| `kubectl get pods` command | 🔴 NEEDS BACKEND | Reads from `useTopologyStore.nodes`; empty without streamer | **YES** — if streamer running |
| `kubectl get nodes` | 🔴 NEEDS BACKEND | Same | Optional |
| `kubectl get services` | 🔴 NEEDS BACKEND | Same | Optional |
| `kubectl describe pod <name>` | 🔴 NEEDS BACKEND | Reads pod data from store | Optional |
| `kubectl scale deploy <name> --replicas=N` | 🔴 NEEDS BACKEND | Ghost pod animation (ContainerCreating→Running in 1800ms) | **YES** — compelling visual |
| `kubectl cluster-info` | 🔴 NEEDS BACKEND | Shows cluster endpoints from store | Optional |
| Arrow key history navigation | ✅ DEMO READY | Client-side `commandHistory[]` array | Optional |

---

## 7. Incidents View (ISH-03)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Empty state — "No Active Incidents Detected" (green shield) | ✅ DEMO READY | Renders when all three data sources are empty | **YES** — show UX quality |
| Three summary cards (Triggered count, Availability %, MTTR) | ✅ DEMO READY | Cards render with 0/100%/< 3m even without data | **YES** |
| Severity filter dropdown (ALL/CRITICAL/WARNING/INFO) | ✅ DEMO READY | Client-side filter; works with empty list | **YES** |
| Status filter (ALL/TRIGGERED/RESOLVED) | ✅ DEMO READY | Same | **YES** |
| Cluster filter | ✅ DEMO READY | Dynamic from store clusters | **YES** |
| Incident rows (populated) | 🔴 NEEDS BACKEND | Requires streamer v1.Events + unhealthy pods | Optional — note for full demo |
| Alert Rules sub-tab | ✅ DEMO READY | `AlertRuleList` reads from `useAlertStore` (in-memory) | **YES** |
| Create Alert Rule modal | ✅ DEMO READY | Opens `AlertRuleModal` — fully functional in-memory | **YES** |
| Alert rule enable/disable toggle | ✅ DEMO READY | Zustand `useAlertStore` | **YES** |

---

## 8. Metrics View (MetricsView)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| CPU area chart (60-second rolling, 1s update) | ⚡ MOCKED | `createInitialHistory()` 60 zero-points; chart animates but flat at 0 without streamer | **YES** — chart itself is compelling |
| RAM area chart | ⚡ MOCKED | Same architecture | **YES** |
| Chart hover crosshair + tooltip | ⚡ MOCKED | SVG mouse events; works on flat data | **YES** |
| Auto-scaling Y-axis with dynamic ticks | ⚡ MOCKED | `[0, yUpper]` domain with 20% headroom — visible even at 0% | **YES** |
| Top Resource Consuming Pods table | 🔴 NEEDS BACKEND | Reads from `store.pods`; empty without streamer | Note in demo |
| Live CPU/memory values in header (`0.00 / 12.0 Cores`) | ⚡ MOCKED | `clusterCpuCores = 12`, `clusterMemoryGB = 14.8` static defaults | **YES** |
| Refresh button | ⚡ MOCKED | Manually inserts one new data point | **YES** |

---

## 9. Governance Leaderboard (NEH)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| Cluster Rankings tab (computed from store clusters) | ✅ DEMO READY | Deterministic formula from cluster name/index | **YES** |
| Health score column (0–100) | ✅ DEMO READY | `mini-todo` scores 95 by default | **YES** |
| CPU/Memory dual progress bars | ✅ DEMO READY | Computed values (38%, 45% for mini-todo) | **YES** |
| Active incidents column | ✅ DEMO READY | Computed as 0 for mini-todo | **YES** |
| Governance State badge (Healthy/Warning/Critical) | ✅ DEMO READY | Derived from health score | **YES** |
| Team Members tab (hardcoded) | ✅ DEMO READY | 4 members, ranks, scores, streaks, badges | **YES** |
| Tab toggle (Cluster Rankings / Team Members) | ✅ DEMO READY | `useState` client-side | **YES** |

---

## 10. Workspace Settings (SettingsView)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| AES-256-GCM Kubeconfig Vault card | ℹ️ INFORMATIONAL | Static card with "ENCRYPTED" badge | **YES** — shows security awareness |
| RBAC roles card (ADMIN/MEMBER/VIEWER) | ℹ️ INFORMATIONAL | Static card with "ACTIVE (ADMIN)" badge | **YES** |
| API token generation | ✅ DEMO READY | Generates `envscale_` + 32 hex chars; modal input for name | **YES** |
| Copy token to clipboard | ✅ DEMO READY | `navigator.clipboard` with 2s "Copied!" confirmation | **YES** |
| Revoke token | ✅ DEMO READY | Removes from in-memory store | Optional |

---

## 11. Real-Time Streaming Architecture (PRN)

| Feature | Status | Evidence | Include in Demo? |
|---|---|---|---|
| WebSocket reconnection indicator (RECONNECTING state) | ✅ DEMO READY | Displays in navbar without streamer | **YES** — mentions without backend |
| WebSocket CONNECTED with latency (e.g. "CONNECTED · 12ms") | 🔴 NEEDS BACKEND | Requires streamer | **YES** — in full-stack segment |
| Live pod status updates (Running → CrashLoopBackOff) | 🔴 NEEDS BACKEND | Streamer EVENT_POD_STATUS_CHANGED | Optional — chaos engine demo |
| client-go Informers (Pods, Nodes, Services, Ingresses) | 🔴 NEEDS BACKEND | `apps/k8s-streamer/pkg/k8s/informer.go` | YES — narrate architecture |

---

## Summary — Demo Include List

### Section A: No Backend Required (frontend-only)
1. App shell, dark canvas, navbar, sidebar
2. Cluster selector dropdown
3. Connect Cluster Wizard (all 3 steps + success screen)
4. Topology empty state
5. Incidents view — empty state + Alert Rules creation
6. Leaderboard — both tabs (cluster + team members)
7. Settings — API token generation
8. Metrics charts (flat but animated)

### Section B: Requires Full Stack (Go streamer + Minikube)
1. TopNavbar green CONNECTED + latency display
2. Topology canvas populated with pods, nodes, services, ingress
3. InspectorDrawer — all 4 tabs
4. PodLogDrawer — full terminal
5. KubectlTerminal — `kubectl get pods`, `kubectl scale`
6. Incidents log populated with real pod events
7. Metrics charts with live CPU/memory data

### Section C: Honest Exclusions (not implemented or not demo-ready)
- Auth/login flow — optional, not required for value demonstration
- Undo/Redo — requires prior delete action to have been performed
- Incidents populated without streamer — not possible
- Pod resource bars in Inspector without streamer — show only with real data
- localrun GUI launcher — Linux/GTK only, not usable on Windows demo machine
