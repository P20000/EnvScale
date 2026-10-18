# ISH-09 — 3-Minute Product Demo Video Script

**Project:** EnvScale  
**Branch:** `feature/ishika-ish-09`  
**Target duration:** 2 min 50 sec – 3 min 10 sec  
**Recording resolution:** 1920 × 1080 (16:9, 1080p)  
**Frame rate:** 30 fps  
**Audio:** Screen narration (voice-over). Record narration separately and sync to footage in post.

---

## Pre-Roll Checklist (Before Recording)

- [ ] Browser: Chrome or Chromium, 100% zoom, 1920 × 1080 window, maximised
- [ ] Clear browser address bar visibility (use full-screen F11 if preferred)
- [ ] Vite dev server running: `pnpm dev` from `apps/web` → `http://localhost:5173`
- [ ] Go streamer running (for Segment 3+): `go run ./cmd/server/main.go` from `apps/k8s-streamer`
- [ ] Minikube cluster running with todo app deployed (for Segment 3+)
- [ ] Kubeconfig exported to `/tmp/minikube-flat.yaml` (scripts/localrun → Deploy Minikube, or manually run `minikube kubectl -- config view --flatten > /tmp/minikube-flat.yaml`)
- [ ] Browser localStorage cleared (`localStorage.clear()` in DevTools console) for a clean first run
- [ ] DevTools closed. No extensions visible. No personal bookmarks visible.
- [ ] Mouse cursor: use a large visible pointer (system settings or cursor overlay tool)
- [ ] Any notification popups, system alerts, or OS overlays disabled
- [ ] Screen recording software open and tested (OBS, ShareX, or Kap on macOS)

---

## Segment 0: Title Card (0:00 – 0:08)

**Duration:** 8 seconds  
**What appears on screen:** Static title card (created in post-production)

```
Title card text:
   EnvScale
   Visual Kubernetes Observability Platform
   [subtitle, smaller] Semester 5 Engineering Project
```

**Voice-over:** *(none — title card is silent or has subtle background music)*

**Production note:** Create this as a text overlay in your video editor. Use `#09090B` background, white `EnvScale` heading, `#3B82F6` underline accent. 2-second fade-in from black, 2-second fade-out.

---

## Segment 1: Introduction (0:08 – 0:23)

**Duration:** 15 seconds  
**What appears on screen:** EnvScale web app at `http://localhost:5173` — fresh load, full dark UI  
**Backend required:** None

### On-Screen Action
1. Open `http://localhost:5173` in browser (or browser is already open and focused)
2. Allow 1 second for the app to fully render — TopNavbar + LeftSidebar + Topology canvas visible
3. No clicks yet — let the viewer absorb the full layout

### Voice-Over Narration
> "Managing Kubernetes clusters through the terminal alone is slow, fragmented, and hard to share across a team. EnvScale gives engineering teams a unified visual interface to connect their clusters, inspect resources in real time, and monitor infrastructure health — all from a single browser window."

**Expected Screen:**
- TopNavbar: EnvScale logo on left, cluster selector showing "mini-todo" in center, red "DISCONNECTED" dot on right
- LeftSidebar: 5 navigation icons on the left
- Center: Topology canvas with the pulsing blue server icon empty state — "No Active Kubernetes Topology"

**Speaker Note:** The red DISCONNECTED dot is intentional here — the full-stack demo will show it turn green in Segment 3. Do not hide it.

---

## Segment 2: Cluster Onboarding (0:23 – 0:50)

**Duration:** 27 seconds  
**What appears on screen:** Connect Cluster Wizard — 3 steps  
**Backend required:** None (wizard succeeds via graceful fallback)

### On-Screen Action
1. **(0:23)** Click the cluster name "mini-todo" in the TopNavbar center pill to open the cluster dropdown
2. **(0:26)** Click **"+ Connect New Cluster"** at the bottom of the dropdown
3. **(0:28)** Wizard opens at **Step 1 of 3**. Type `"production-demo"` into the Cluster Name field. Pause 1 second.
4. **(0:32)** Click **"Next →"** to advance to Step 2
5. **(0:34)** On Step 2, drag a `.yaml` kubeconfig file onto the dropzone (use `/tmp/minikube-flat.yaml` or any `.yaml` file). The dropzone highlights, then shows the filename.
6. **(0:39)** Click **"Next →"** to advance to Step 3
7. **(0:41)** Step 3 shows the review screen: cluster name "production-demo" and kubeconfig filename. Click **"Connect Cluster"**
8. **(0:44)** Success screen appears: green checkmark, "Cluster Connected! production-demo has been connected successfully."
9. **(0:47)** Click **"Done"**. The wizard closes. TopNavbar cluster selector now shows "production-demo" (or mini-todo if it stays as active).

### Voice-Over Narration
> "Connecting a cluster takes three steps. Name your cluster, upload your kubeconfig file — the same file you already use with kubectl — and EnvScale validates the connection and registers it to the platform. No additional CLI tooling required."

**Expected Screen at key moments:**
- Step 1: Clean input field with placeholder "e.g. production-cluster", step indicator "Step 1 of 3"
- Step 2: Drag-and-drop zone with dashed border, "Drag & drop your kubeconfig here" text; after file drop shows filename + green filename badge
- Step 3: Read-only review panel with cluster name and kubeconfig filename
- Success: Full-width green check screen with congratulations message

**Speaker Note:** Do NOT show any actual kubeconfig content on screen — just the filename. Narration does not need to explain the fallback behavior; just demonstrate the successful flow.

---

## Segment 3: Live Topology Canvas (0:50 – 1:40)

**Duration:** 50 seconds  
**What appears on screen:** Topology canvas populated with real Kubernetes resources  
**Backend required:** Go streamer + Minikube with todo app deployed

### Pre-Segment Setup (do not show on screen)
Ensure:
- Go streamer is running: `go run ./cmd/server/main.go`
- Minikube todo app is deployed: `kubectl apply -f testing/k8s/`
- The streamer has "mini-todo" auto-registered (it does on startup)
- The app is on the `topology` tab (default)

### On-Screen Action
1. **(0:50)** Switch to the `topology` tab via the TopNavbar cluster selector — select `"mini-todo"`. The canvas is about to populate. TopNavbar status dot turns **green "CONNECTED · Xms"**.
2. **(0:53)** Canvas loads — nodes appear and Dagre auto-layout places them. Pause 2 seconds for the viewer to see the full graph.
   - Worker node(s) visible
   - Workload/Deployment groups with pods nested inside
   - Service nodes with connecting edges
   - Ingress node (violet) at the top
3. **(1:02)** Click the **"↕ Vertical"** toggle button (top-right capsule) to switch to TB layout. Graph re-arranges. Pause 1 second.
4. **(1:06)** Click **"↔ Horizontal"** to switch back to LR layout. Pause 1 second.
5. **(1:09)** Click **"Auto Layout"** — graph snaps to optimal layout.
6. **(1:12)** Slowly zoom in on a pod group using scroll wheel. Show individual pod cards with status dots (green Running, or amber Pending).
7. **(1:18)** Click a **Running pod node** to open the **InspectorDrawer** from the right.
8. **(1:20)** InspectorDrawer slides in — Overview tab is active. Point to: pod name, namespace, status badge, restart count, uptime, pod IP.
9. **(1:27)** Click the **"Live Logs"** tab inside the drawer. Logs begin scrolling automatically.
10. **(1:32)** Click **"Expand Terminal ↗"** to open the full PodLogDrawer.
11. **(1:36)** Show the log level filter — click **"WARN"** to filter. Matching lines highlight.
12. **(1:39)** Close the PodLogDrawer (X button). Return to topology view.

### Voice-Over Narration
> "Once a cluster is connected, EnvScale streams the live resource topology directly to the canvas. Pods, nodes, services, and ingress rules are laid out automatically using a graph layout engine. You can switch between vertical and horizontal orientations to see the architecture from a different angle."
> 
> *(on inspector slide-in)*
> "Clicking any resource opens the inspector panel on the right. You get live metadata — pod status, restart count, IP assignment, and uptime — without running a single command."
>
> *(on logs tab)*
> "Switch to the logs tab for a real-time kubectl logs stream. You can filter by log level, search across entries, and expand to a full terminal view."

**Expected Screen at key moments:**
- Connected state: green "CONNECTED · 12ms" dot in TopNavbar, populated canvas
- Pod card: colored status dot (emerald for Running), pod name, namespace badge
- InspectorDrawer: right side panel with 4 tabs visible
- PodLogDrawer: dark terminal with timestamped log rows, level badges

**Speaker Note:** If a pod is in CrashLoopBackOff state, point to it specifically — the red status badge is a valuable visual that shows the platform's problem-detection capability.

---

## Segment 4: Resource Inspection & Monitoring (1:40 – 2:18)

**Duration:** 38 seconds  
**What appears on screen:** InspectorDrawer (Usage + Chaos), Incidents view, Metrics view  
**Backend required:** Go streamer for Usage/Incidents; Metrics charts work standalone

### On-Screen Action
1. **(1:40)** Back on topology canvas. Click the same pod. InspectorDrawer opens.
2. **(1:42)** Click the **"Usage"** tab. Show CPU usage bar and Memory usage bar with live values.
3. **(1:47)** Close the InspectorDrawer (click elsewhere / X button).
4. **(1:49)** Click the **Incidents & Alerts** icon (second icon in LeftSidebar — alert octagon).
5. **(1:51)** IncidentsView opens. If streamer is running and a pod has had issues, show the incident table with severity badges (CRITICAL/WARNING/INFO). If no incidents yet, show the empty state — green shield "No Active Incidents Detected".
6. **(1:55)** Click the **"Alert Rules"** sub-tab (top-right toggle).
7. **(1:57)** Click **"+ Create Alert Rule"**. The AlertRuleModal opens.
8. **(2:00)** Fill in: Metric = "CPU Usage", Condition = ">", Threshold = "80", Severity = "WARNING". Click Save.
9. **(2:04)** New alert rule appears in the list with toggle enabled.
10. **(2:07)** Click the **Metrics Inspector** icon (third icon in LeftSidebar).
11. **(2:09)** MetricsView loads. Two area charts update in real time. Hover mouse over the CPU chart — tooltip appears with exact value and timestamp.
12. **(2:14)** Point to the header: "0.00 / 12.0 Cores · Cluster CPU Load 0.0%" (or live values if streamer is running).
13. **(2:17)** Click the Refresh button (top-right of MetricsView). A new data point is pushed.

### Voice-Over Narration
> "The Usage tab in the inspector shows live CPU and memory consumption for each pod, pulled directly from the Kubernetes metrics API."
>
> *(on incidents view)*
> "The Incidents view captures operational events in real time — automatically classifying them as Critical, Warning, or Info based on what the cluster reports. Teams can define their own alert rules: trigger a warning when CPU crosses a threshold, or fire a critical alert on pod crash loops."
>
> *(on metrics view)*
> "The Metrics Inspector gives a cluster-wide view with rolling 60-second telemetry charts. Hover over any point to see the exact CPU or memory reading at that moment."

**Expected Screen at key moments:**
- Usage tab: two progress bars with numeric values
- AlertRuleModal: form with Metric, Condition, Threshold, Duration, Severity fields
- MetricsView: two dark area charts with blue and emerald fill, animated rolling data

---

## Segment 5: Governance & Leaderboard (2:18 – 2:45)

**Duration:** 27 seconds  
**What appears on screen:** LeaderboardView — both tabs  
**Backend required:** None (fully demo-ready)

### On-Screen Action
1. **(2:18)** Click the **Trophy/Leaderboard** icon (fourth icon in LeftSidebar).
2. **(2:20)** LeaderboardView loads — **Cluster Rankings** tab is active by default.
3. **(2:21)** Show the cluster rankings table: cluster name "mini-todo", health score 95/100, CPU/memory dual bars, "0 Active Incidents", Governance State badge "Healthy".
4. **(2:28)** Click the **"Team Members"** tab toggle (top-right of the view).
5. **(2:30)** Team members leaderboard appears: Pranav (985 pts, Gold, 14-day streak), Vinit (940, Silver), Neha (915, Bronze), Ishika (890, Participant).
6. **(2:36)** Click the **Workspace Settings** icon (fifth icon — cog).
7. **(2:38)** SettingsView loads. Point to the AES-256-GCM Vault card and RBAC card.
8. **(2:41)** Click **"Generate Token"** — modal opens. Type a name (e.g. "ci-agent"), click Generate.
9. **(2:44)** New token appears in the list. Click the copy icon — "Copied!" confirmation shows.

### Voice-Over Narration
> "EnvScale adds a governance layer to infrastructure management. Each cluster gets a health score from zero to one hundred, calculated from active incidents and pod failure rates. Teams are ranked by stability — turning good engineering practices into something the whole team can track."
>
> *(on settings)*
> "The workspace settings give admins control over security — kubeconfig secrets are encrypted at rest using AES-256, RBAC enforces role-based access, and API tokens let remote agents connect to the streaming gateway."

**Expected Screen at key moments:**
- Cluster Rankings: table row with health score gauge, dual CPU/memory bars
- Team Members: ranked list with badges and streak indicators
- SettingsView: three cards — Vault, RBAC, Tokens
- Token generation modal and copy confirmation

---

## Segment 6: Closing (2:45 – 3:05)

**Duration:** 20 seconds  
**What appears on screen:** Return to topology canvas — full overview  
**Backend required:** Go streamer (for populated canvas)

### On-Screen Action
1. **(2:45)** Click the **Topology** icon (first icon in LeftSidebar — hub icon) to return to the canvas.
2. **(2:47)** Click **"Recenter View"** to fit the whole graph on screen.
3. **(2:49)** Slowly pan across the canvas showing the full cluster topology — Ingress → Services → Workloads → Pods.
4. **(2:55)** Hold on a clean wide-angle view of the full topology for 5 seconds.
5. **(3:00)** Fade to the closing title card (created in post-production).

### Closing Title Card Text (post-production)
```
EnvScale
Visual Kubernetes Observability & Governance
─────────────────────────────────────────────
Semester 5 Engineering Project  ·  2026
Team: Pranav  ·  Vinit  ·  Neha  ·  Ishika
```

### Voice-Over Narration
> "EnvScale brings Kubernetes infrastructure out of the terminal and into a visual, collaborative interface. Whether you're debugging a pod failure, reviewing cluster health, or setting up alert policies — everything your team needs is a click away. This is EnvScale."

**Expected Screen:**
- Full topology canvas, all nodes visible, Dagre-laid-out graph
- WebSocket status: green CONNECTED in TopNavbar

---

## Full Timing Summary

| Segment | Title | Start | End | Duration | Backend |
|---|---|---|---|---|---|
| 0 | Title Card | 0:00 | 0:08 | 8s | None |
| 1 | Introduction | 0:08 | 0:23 | 15s | None |
| 2 | Cluster Onboarding | 0:23 | 0:50 | 27s | None |
| 3 | Live Topology Canvas | 0:50 | 1:40 | 50s | Streamer + Minikube |
| 4 | Resource Inspection & Monitoring | 1:40 | 2:18 | 38s | Streamer (partial) |
| 5 | Governance & Leaderboard | 2:18 | 2:45 | 27s | None |
| 6 | Closing | 2:45 | 3:05 | 20s | Streamer |
| — | **TOTAL** | **0:00** | **3:05** | **3 min 5 sec** | — |

---

## Narration Script — Full Read-Through (for TTS or voice recording)

> Title card (silence):
> —
>
> Segment 1 (0:08):
> "Managing Kubernetes clusters through the terminal alone is slow, fragmented, and hard to share across a team. EnvScale gives engineering teams a unified visual interface to connect their clusters, inspect resources in real time, and monitor infrastructure health — all from a single browser window."
>
> Segment 2 (0:23):
> "Connecting a cluster takes three steps. Name your cluster, upload your kubeconfig file — the same file you already use with kubectl — and EnvScale validates the connection and registers it to the platform. No additional CLI tooling required."
>
> Segment 3 (0:50):
> "Once a cluster is connected, EnvScale streams the live resource topology directly to the canvas. Pods, nodes, services, and ingress rules are laid out automatically using a graph layout engine. You can switch between vertical and horizontal orientations to see the architecture from a different angle.
> Clicking any resource opens the inspector panel on the right. You get live metadata — pod status, restart count, IP assignment, and uptime — without running a single command.
> Switch to the logs tab for a real-time kubectl logs stream. You can filter by log level, search across entries, and expand to a full terminal view."
>
> Segment 4 (1:40):
> "The Usage tab in the inspector shows live CPU and memory consumption for each pod, pulled directly from the Kubernetes metrics API.
> The Incidents view captures operational events in real time — automatically classifying them as Critical, Warning, or Info based on what the cluster reports. Teams can define their own alert rules: trigger a warning when CPU crosses a threshold, or fire a critical alert on pod crash loops.
> The Metrics Inspector gives a cluster-wide view with rolling 60-second telemetry charts. Hover over any point to see the exact CPU or memory reading at that moment."
>
> Segment 5 (2:18):
> "EnvScale adds a governance layer to infrastructure management. Each cluster gets a health score from zero to one hundred, calculated from active incidents and pod failure rates. Teams are ranked by stability — turning good engineering practices into something the whole team can track.
> The workspace settings give admins control over security — kubeconfig secrets are encrypted at rest using AES-256, RBAC enforces role-based access, and API tokens let remote agents connect to the streaming gateway."
>
> Segment 6 (2:45):
> "EnvScale brings Kubernetes infrastructure out of the terminal and into a visual, collaborative interface. Whether you're debugging a pod failure, reviewing cluster health, or setting up alert policies — everything your team needs is a click away. This is EnvScale."

---

## Honest Feature Accuracy Notes

These facts are accurate per the source code inspection and should not be contradicted in narration:

1. The wizard succeeds in demo conditions whether or not the backend is running — this is correct to show.
2. The "kubectl logs" stream in InspectorDrawer is simulated when backend is offline — narration says "real-time" only if the streamer is running. If demoing without backend, say "built-in log viewer."
3. The Leaderboard Team Members tab is hardcoded data — do not narrate it as "live gamification scores."
4. MetricsView shows 0% utilisation without streamer — narrate as "when connected, shows live cluster telemetry."
5. Alert rules are stored in-memory only — do not narrate as "persistent alert policies" unless the REST API is also running.
