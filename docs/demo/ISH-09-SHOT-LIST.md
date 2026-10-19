# ISH-09 — Shot List & Recording Checklist

**Project:** EnvScale  
**Branch:** `feature/ishika-ish-09`  
**Total shots:** 42  
**Recording format:** Screen capture, 1920 × 1080, 30 fps  
**Cursor:** Large visible system cursor or cursor-highlight overlay enabled

---

## Legend

| Column | Description |
|---|---|
| Shot | Sequential shot number |
| Timestamp | Approximate time in final video |
| Duration | How long this shot should last |
| Screen/Page | Which view is visible |
| Action | What to do with the mouse/keyboard |
| Expected Visual | What should be visible for a clean take |
| Retake Condition | When to discard and redo this shot |
| Backend? | Whether services need to be running |

---

## PHASE A — Frontend-Only Shots (No Backend Required)

Run these with only `pnpm dev` (Vite at localhost:5173). Do not start the streamer yet.

---

### Shot 001
| Field | Value |
|---|---|
| **Shot** | 001 |
| **Timestamp** | 0:00 – 0:08 |
| **Duration** | 8s |
| **Screen** | Post-production title card |
| **Action** | None — create in video editor |
| **Expected Visual** | Dark `#09090B` background, white "EnvScale" heading, blue subtitle |
| **Retake Condition** | N/A — created in post |
| **Backend?** | None |

---

### Shot 002 — App First Load
| Field | Value |
|---|---|
| **Shot** | 002 |
| **Timestamp** | 0:08 – 0:14 |
| **Duration** | 6s |
| **Screen** | Topology tab (default) |
| **Action** | Open browser to `http://localhost:5173`. No clicks. Let the UI render fully. |
| **Expected Visual** | TopNavbar (logo + "mini-todo" cluster + red DISCONNECTED dot), LeftSidebar 5 icons, topology empty state (pulsing blue server icon + "No Active Kubernetes Topology") |
| **Retake Condition** | Any console error visible, any browser extension toolbar visible, wrong tab active |
| **Backend?** | None |

---

### Shot 003 — Narration Window
| Field | Value |
|---|---|
| **Shot** | 003 |
| **Timestamp** | 0:14 – 0:23 |
| **Duration** | 9s |
| **Screen** | Topology tab — same as 002, no new action |
| **Action** | Slowly pan view or do nothing. Allow narration to complete over the static screen. |
| **Expected Visual** | Same as 002 — clean stable frame |
| **Retake Condition** | Reconnecting animation in navbar distracts; if so, pause recording briefly until it stabilises on a clean state |
| **Backend?** | None |

---

### Shot 004 — Open Cluster Dropdown
| Field | Value |
|---|---|
| **Shot** | 004 |
| **Timestamp** | 0:23 – 0:26 |
| **Duration** | 3s |
| **Screen** | TopNavbar cluster selector |
| **Action** | Click the "mini-todo ▾" pill in the center of the TopNavbar |
| **Expected Visual** | Dropdown appears: "Active Kubernetes Clusters" header, "mini-todo" item with green checkmark, "Connect New Cluster +" at bottom |
| **Retake Condition** | Dropdown does not open, or shows unexpected cluster names from a previous session |
| **Backend?** | None |

> **Pre-shot note:** If `localStorage` has stale cluster names from a previous session, run `localStorage.clear()` in DevTools Console and refresh before recording.

---

### Shot 005 — Click Connect New Cluster
| Field | Value |
|---|---|
| **Shot** | 005 |
| **Timestamp** | 0:26 – 0:28 |
| **Duration** | 2s |
| **Screen** | Cluster dropdown → Wizard opening |
| **Action** | Click the "+ Connect New Cluster" button at the bottom of the dropdown |
| **Expected Visual** | Dropdown closes; ConnectClusterWizard modal appears with "Connect Cluster" heading, "Step 1 of 3", Cluster Name input field |
| **Retake Condition** | Modal is partially off-screen, or backdrop is missing |
| **Backend?** | None |

---

### Shot 006 — Type Cluster Name
| Field | Value |
|---|---|
| **Shot** | 006 |
| **Timestamp** | 0:28 – 0:34 |
| **Duration** | 6s |
| **Screen** | Wizard — Step 1 |
| **Action** | Click the "Cluster Name" input. Type "production-demo" slowly (1 character per ~0.3s so it is readable on screen). Pause 1s after typing. |
| **Expected Visual** | Input field shows "production-demo" typed progressively, no error state |
| **Retake Condition** | Typo visible and not corrected on camera; input field shows red error before submitting |
| **Backend?** | None |

---

### Shot 007 — Advance to Step 2
| Field | Value |
|---|---|
| **Shot** | 007 |
| **Timestamp** | 0:34 – 0:36 |
| **Duration** | 2s |
| **Screen** | Wizard — Step 1 → Step 2 transition |
| **Action** | Click "Next →" button |
| **Expected Visual** | Step indicator changes to "Step 2 of 3"; Kubeconfig upload dropzone appears |
| **Retake Condition** | Step does not advance (validation error showing — means name field was empty) |
| **Backend?** | None |

---

### Shot 008 — Drag Kubeconfig File
| Field | Value |
|---|---|
| **Shot** | 008 |
| **Timestamp** | 0:36 – 0:41 |
| **Duration** | 5s |
| **Screen** | Wizard — Step 2 |
| **Action** | Drag `/tmp/minikube-flat.yaml` (or any `.yaml` file) from a file manager window onto the drop zone. If drag is awkward, use "Browse File" button to select the file via the file picker dialog. |
| **Expected Visual** | While dragging: dropzone border highlights with blue glow. After drop: filename shown (e.g. "minikube-flat.yaml") with green badge and a remove (×) button |
| **Retake Condition** | File picker dialog shows internal file paths or home directory that should not be visible; use a neutral file location like Desktop |
| **Backend?** | None |

> **Privacy note:** Make sure the `.yaml` file does not display sensitive content in the dialog. Pre-place the file on the Desktop as `kubeconfig-demo.yaml`.

---

### Shot 009 — Advance to Step 3
| Field | Value |
|---|---|
| **Shot** | 009 |
| **Timestamp** | 0:41 – 0:43 |
| **Duration** | 2s |
| **Screen** | Wizard — Step 2 → Step 3 |
| **Action** | Click "Next →" button |
| **Expected Visual** | Step 3 review screen: cluster name "production-demo", kubeconfig filename, "Connect Cluster" button |
| **Retake Condition** | Step does not advance, or filename is missing |
| **Backend?** | None |

---

### Shot 010 — Connect Cluster
| Field | Value |
|---|---|
| **Shot** | 010 |
| **Timestamp** | 0:43 – 0:47 |
| **Duration** | 4s |
| **Screen** | Wizard — Step 3 → Success |
| **Action** | Click the "Connect Cluster" button. Wait for success state. |
| **Expected Visual** | Button shows loading spinner briefly (or immediate), then success screen: large green checkmark icon, "Cluster Connected!", "production-demo has been connected successfully." |
| **Retake Condition** | Error screen appears (red ×) — check that the fallback is working correctly. If error still appears, the VITE_ env might be pointing to a real server that is rejecting the request. |
| **Backend?** | None (fallback handles offline state) |

---

### Shot 011 — Dismiss Wizard
| Field | Value |
|---|---|
| **Shot** | 011 |
| **Timestamp** | 0:47 – 0:50 |
| **Duration** | 3s |
| **Screen** | Wizard success → Topology tab |
| **Action** | Click "Done". Wizard modal closes. |
| **Expected Visual** | Modal closes, app returns to Topology tab. TopNavbar cluster selector may now show "production-demo" or remain on "mini-todo". |
| **Retake Condition** | Modal does not close cleanly |
| **Backend?** | None |

---

## PHASE B — Full-Stack Shots (Go Streamer + Minikube Required)

Before shooting Phase B:
- [ ] Confirm `go run ./cmd/server/main.go` is running (terminal output shows "K8s Streamer listening :8080")
- [ ] Confirm Minikube is running: `minikube status`
- [ ] Confirm todo app is deployed: `kubectl get pods -n testing-todo` (all Running)
- [ ] Confirm streamer auto-registered `mini-todo`: check streamer stdout for "Cluster registered: mini-todo"
- [ ] In the browser, select cluster `"mini-todo"` from the TopNavbar dropdown so the WebSocket connects to it

---

### Shot 012 — WebSocket CONNECTED State
| Field | Value |
|---|---|
| **Shot** | 012 |
| **Timestamp** | 0:50 – 0:53 |
| **Duration** | 3s |
| **Screen** | TopNavbar — status indicator area |
| **Action** | Switch to `mini-todo` cluster in TopNavbar dropdown. Wait for WebSocket to connect. |
| **Expected Visual** | TopNavbar status dot turns **green** with text "CONNECTED · {N}ms". Cluster selector shows "mini-todo ▾". |
| **Retake Condition** | Dot stays red/amber, or shows "RECONNECTING" for more than 5 seconds |
| **Backend?** | Go streamer must be running |

---

### Shot 013 — Canvas Populates
| Field | Value |
|---|---|
| **Shot** | 013 |
| **Timestamp** | 0:53 – 1:02 |
| **Duration** | 9s |
| **Screen** | Topology canvas — nodes appearing |
| **Action** | Stay on topology tab. Let the canvas auto-populate via WebSocket snapshot. Do not click anything. |
| **Expected Visual** | Nodes appear on the canvas and Dagre auto-layout arranges them. Graph includes: Worker node, Deployment/Group workloads, Pod cards (green Running dots), Service nodes, Ingress node (violet). ArgoEdge connections between nodes animate. |
| **Retake Condition** | Canvas remains empty after 5 seconds; fewer than 4–5 nodes appear; layout is visually broken or overlapping |
| **Backend?** | Go streamer + Minikube required |

---

### Shot 014 — Toggle Layout Direction (TB)
| Field | Value |
|---|---|
| **Shot** | 014 |
| **Timestamp** | 1:02 – 1:06 |
| **Duration** | 4s |
| **Screen** | Topology canvas — top-right action capsule |
| **Action** | Click **"↕ Vertical"** toggle button (top-right capsule). Graph re-animates into TB (top-to-bottom) layout. |
| **Expected Visual** | Graph transitions smoothly to vertical orientation (Ingress at top, pods at bottom). `fitView` re-centers with 400ms animation. |
| **Retake Condition** | Layout does not change, or graph goes off-screen after toggle |
| **Backend?** | Go streamer |

---

### Shot 015 — Toggle Layout Direction (LR)
| Field | Value |
|---|---|
| **Shot** | 015 |
| **Timestamp** | 1:06 – 1:09 |
| **Duration** | 3s |
| **Screen** | Topology canvas — action capsule |
| **Action** | Click **"↔ Horizontal"** toggle to return to LR layout. |
| **Expected Visual** | Graph transitions back to left-to-right orientation. |
| **Retake Condition** | Same as shot 014 |
| **Backend?** | Go streamer |

---

### Shot 016 — Auto Layout
| Field | Value |
|---|---|
| **Shot** | 016 |
| **Timestamp** | 1:09 – 1:12 |
| **Duration** | 3s |
| **Screen** | Topology canvas — action capsule |
| **Action** | Click **"Auto Layout"** button. Graph snaps to clean Dagre placement. |
| **Expected Visual** | Nodes animate to their calculated positions cleanly, no overlaps |
| **Retake Condition** | Overlapping nodes after layout |
| **Backend?** | Go streamer |

---

### Shot 017 — Zoom Into Pod Group
| Field | Value |
|---|---|
| **Shot** | 017 |
| **Timestamp** | 1:12 – 1:18 |
| **Duration** | 6s |
| **Screen** | Topology canvas — zoomed into a pod group |
| **Action** | Scroll-wheel zoom in on the area with pod cards (Deployment group). Zoom until individual pod names and status dots are clearly readable. |
| **Expected Visual** | 2–4 pod cards visible with clear names, colored status dots (emerald green for Running pods), restart count "Restarts: 0" or small number |
| **Retake Condition** | Pod names are truncated and unreadable; status dots are too small to see; zoomed too far (pods are pixelated) |
| **Backend?** | Go streamer |

---

### Shot 018 — Click Pod to Open Inspector
| Field | Value |
|---|---|
| **Shot** | 018 |
| **Timestamp** | 1:18 – 1:20 |
| **Duration** | 2s |
| **Screen** | Topology canvas → InspectorDrawer opens |
| **Action** | Click a Running pod node. The pod card gets a 2px blue selection ring. InspectorDrawer slides in from right. |
| **Expected Visual** | InspectorDrawer appears on right side (420px wide). "Overview" tab is active. Pod name visible in drawer header. |
| **Retake Condition** | Drawer does not appear; drawer animation is janky or clips off screen |
| **Backend?** | Go streamer |

---

### Shot 019 — Inspector Overview Tab
| Field | Value |
|---|---|
| **Shot** | 019 |
| **Timestamp** | 1:20 – 1:27 |
| **Duration** | 7s |
| **Screen** | InspectorDrawer — Overview tab |
| **Action** | Hold on the Overview tab. Slowly move cursor to highlight different data fields: name, namespace, status, restarts, uptime, pod IP. Do not click yet. |
| **Expected Visual** | "Workload Details" section with: Resource Name (pod name), Namespace, Status ("Running" in green), Restarts count. "Placement & IP" section with: Node Assignment, Pod IP Address, Uptime (e.g. "2h 14m"). Embedded log stream at the bottom (scrolling). |
| **Retake Condition** | All fields show "unassigned" (pod data is missing from store — streamer issue); uptime is not calculating |
| **Backend?** | Go streamer |

---

### Shot 020 — Switch to Live Logs Tab
| Field | Value |
|---|---|
| **Shot** | 020 |
| **Timestamp** | 1:27 – 1:32 |
| **Duration** | 5s |
| **Screen** | InspectorDrawer — Live Logs tab |
| **Action** | Click the **"Live Logs"** tab inside the drawer. |
| **Expected Visual** | Dark terminal-style log panel. Lines auto-scroll with [INFO], [DEBUG], [WARN] entries. Timestamps visible in ISO format. Pause/Resume icon in top-right of log panel. |
| **Retake Condition** | Log panel is blank (wait 3s for the simulated logs to start); excessive ERROR-level lines that look alarming without context |
| **Backend?** | Simulated — works with or without streamer |

---

### Shot 021 — Expand to Full Terminal
| Field | Value |
|---|---|
| **Shot** | 021 |
| **Timestamp** | 1:32 – 1:36 |
| **Duration** | 4s |
| **Screen** | PodLogDrawer — full terminal |
| **Action** | Click **"Expand Terminal ↗"** in the drawer header area. PodLogDrawer slides in from the right. |
| **Expected Visual** | Full-screen right-side terminal: pod name header, timestamped and color-coded log rows, level filter pills row (ALL/TRACE/DEBUG/INFO/WARN/ERROR/FATAL) |
| **Retake Condition** | PodLogDrawer is blank; level filter pills not visible |
| **Backend?** | Simulated — works standalone |

---

### Shot 022 — Filter by WARN Level
| Field | Value |
|---|---|
| **Shot** | 022 |
| **Timestamp** | 1:36 – 1:39 |
| **Duration** | 3s |
| **Screen** | PodLogDrawer — filtered view |
| **Action** | Click the **"WARN"** level pill in the toolbar. |
| **Expected Visual** | Log lines filtered to WARN level only. Row count in footer updates. If no WARN lines exist in the buffer, try "ERROR" level instead. |
| **Retake Condition** | Clicking WARN shows zero results with no indication (use ERROR or DEBUG level which have more simulated entries) |
| **Backend?** | Simulated |

---

### Shot 023 — Close PodLogDrawer
| Field | Value |
|---|---|
| **Shot** | 023 |
| **Timestamp** | 1:39 – 1:40 |
| **Duration** | 1s |
| **Screen** | PodLogDrawer → Topology canvas |
| **Action** | Click the **X** (Close Terminal) button on the PodLogDrawer header. |
| **Expected Visual** | PodLogDrawer slides out. Topology canvas with InspectorDrawer is visible again. |
| **Retake Condition** | Close button is not found; drawer stays open |
| **Backend?** | N/A |

---

### Shot 024 — Inspector Usage Tab
| Field | Value |
|---|---|
| **Shot** | 024 |
| **Timestamp** | 1:40 – 1:47 |
| **Duration** | 7s |
| **Screen** | InspectorDrawer — Usage tab |
| **Action** | Click the **"Usage"** tab in the InspectorDrawer (if still open; if not, re-click the pod). |
| **Expected Visual** | Two progress bars: CPU usage (mcores with percentage label) and Memory usage (MiB with percentage label). Values should show non-zero if streamer is reporting pod metrics. |
| **Retake Condition** | Both bars show 0% and 0 mcores — this means pod metrics are not in the snapshot; narrate as "populates from Kubernetes Metrics API" and move on quickly |
| **Backend?** | Go streamer + k8s.io/metrics API |

---

### Shot 025 — Close Inspector
| Field | Value |
|---|---|
| **Shot** | 025 |
| **Timestamp** | 1:47 – 1:49 |
| **Duration** | 2s |
| **Screen** | Topology canvas — Inspector closing |
| **Action** | Click on empty canvas space to close InspectorDrawer. |
| **Expected Visual** | InspectorDrawer slides out cleanly. Full canvas visible. |
| **Retake Condition** | Drawer stays open or canvas looks cluttered |
| **Backend?** | N/A |

---

### Shot 026 — Navigate to Incidents
| Field | Value |
|---|---|
| **Shot** | 026 |
| **Timestamp** | 1:49 – 1:51 |
| **Duration** | 2s |
| **Screen** | LeftSidebar → Incidents view transition |
| **Action** | Click the **alert-octagon icon** (second icon in LeftSidebar). |
| **Expected Visual** | View transitions to IncidentsView with sub-tab "Incident History" active. Three summary cards at top. Incident table below. |
| **Retake Condition** | Click misses the icon; wrong view appears |
| **Backend?** | None for the view itself |

---

### Shot 027 — Incidents Empty State OR Populated State
| Field | Value |
|---|---|
| **Shot** | 027 |
| **Timestamp** | 1:51 – 1:55 |
| **Duration** | 4s |
| **Screen** | IncidentsView — Incident History tab |
| **Action** | Hold on this view. Do not click. Let streamer-driven incidents appear if any are present. |
| **Expected Visual** | **Preferred:** Incident table with 1–3 rows, severity badges (Critical/Warning), TRIGGERED/RESOLVED status. **Acceptable fallback:** Green shield empty state with "No Active Incidents Detected" — show it confidently, it demonstrates the healthy state. |
| **Retake Condition** | Only applicable if the incidents table is visually broken (columns misaligned, badges missing) |
| **Backend?** | Optional — show whichever state is present |

---

### Shot 028 — Show Severity Filter
| Field | Value |
|---|---|
| **Shot** | 028 |
| **Timestamp** | 1:55 – 1:57 |
| **Duration** | 2s |
| **Screen** | IncidentsView — filter controls |
| **Action** | Click the **Severity** filter dropdown. Show the options (ALL / CRITICAL / WARNING / INFO). Do not select yet. |
| **Expected Visual** | Dropdown opens showing four options |
| **Retake Condition** | Dropdown does not open |
| **Backend?** | None |

---

### Shot 029 — Switch to Alert Rules Tab
| Field | Value |
|---|---|
| **Shot** | 029 |
| **Timestamp** | 1:57 – 1:59 |
| **Duration** | 2s |
| **Screen** | IncidentsView → Alert Rules sub-tab |
| **Action** | Close the filter dropdown (press Escape or click elsewhere). Then click the **"Alert Rules"** toggle tab (top-right of IncidentsView). |
| **Expected Visual** | Alert Rules list view appears. If no rules exist, the empty state is shown. "+ Create Alert Rule" button visible. |
| **Retake Condition** | Tab does not switch |
| **Backend?** | None |

---

### Shot 030 — Open Alert Rule Modal
| Field | Value |
|---|---|
| **Shot** | 030 |
| **Timestamp** | 1:59 – 2:01 |
| **Duration** | 2s |
| **Screen** | Alert Rule creation modal opens |
| **Action** | Click **"+ Create Alert Rule"** button. |
| **Expected Visual** | Modal opens with form fields: Metric Type selector, Condition selector, Threshold input, Duration input, Severity selector. Cancel and Save buttons. |
| **Retake Condition** | Modal does not open; modal appears outside screen bounds |
| **Backend?** | None |

---

### Shot 031 — Fill and Save Alert Rule
| Field | Value |
|---|---|
| **Shot** | 031 |
| **Timestamp** | 2:01 – 2:07 |
| **Duration** | 6s |
| **Screen** | Alert Rule modal — fill + save |
| **Action** | 1. Set Metric Type to "CPU Usage". 2. Set Condition to ">". 3. Type "80" in threshold field. 4. Set Severity to "WARNING". 5. Click **Save**. |
| **Expected Visual** | Each field interaction looks deliberate. Save causes modal to close. New alert rule row appears in the list with name, metric, threshold, enabled toggle, edit/delete actions. |
| **Retake Condition** | Form validation error (threshold field empty); rule does not appear in list after save |
| **Backend?** | None |

---

### Shot 032 — Navigate to Metrics
| Field | Value |
|---|---|
| **Shot** | 032 |
| **Timestamp** | 2:07 – 2:09 |
| **Duration** | 2s |
| **Screen** | LeftSidebar → Metrics view |
| **Action** | Click the **chart-line icon** (third icon in LeftSidebar). |
| **Expected Visual** | MetricsView appears with two area charts and header stat cards. |
| **Retake Condition** | Wrong view appears |
| **Backend?** | None |

---

### Shot 033 — Chart Animation
| Field | Value |
|---|---|
| **Shot** | 033 |
| **Timestamp** | 2:09 – 2:14 |
| **Duration** | 5s |
| **Screen** | MetricsView — CPU chart |
| **Action** | Hold on the MetricsView without clicking. The 60-second rolling charts update every 1 second. |
| **Expected Visual** | Two SVG area charts with gradient fills. With streamer: live-updating lines showing CPU/memory usage. Without streamer: flat blue/emerald area at 0% but chart axes and grid are visible and the chart still animates. Header shows "0.00 / 12.0 Cores" (or live values). |
| **Retake Condition** | Charts are completely invisible (rendering bug) |
| **Backend?** | Partial — charts always render; values only live with streamer |

---

### Shot 034 — Hover Chart Tooltip
| Field | Value |
|---|---|
| **Shot** | 034 |
| **Timestamp** | 2:14 – 2:17 |
| **Duration** | 3s |
| **Screen** | MetricsView — CPU chart hover |
| **Action** | Move the mouse slowly along the CPU area chart from left to right. |
| **Expected Visual** | Crosshair vertical line tracks the mouse. Tooltip card appears showing exact value (e.g. "0.00%" or live value) + delta timestamp. |
| **Retake Condition** | Tooltip does not appear; crosshair is not visible |
| **Backend?** | None (tooltip works on flat data) |

---

## PHASE C — Leaderboard & Settings (No Backend Required)

---

### Shot 035 — Navigate to Leaderboard
| Field | Value |
|---|---|
| **Shot** | 035 |
| **Timestamp** | 2:18 – 2:20 |
| **Duration** | 2s |
| **Screen** | LeftSidebar → Leaderboard view |
| **Action** | Click the **trophy icon** (fourth icon in LeftSidebar). |
| **Expected Visual** | LeaderboardView loads with "Governance Leaderboard" heading, Cluster Rankings tab active, table of clusters. |
| **Retake Condition** | Wrong view appears |
| **Backend?** | None |

---

### Shot 036 — Cluster Rankings Table
| Field | Value |
|---|---|
| **Shot** | 036 |
| **Timestamp** | 2:20 – 2:28 |
| **Duration** | 8s |
| **Screen** | LeaderboardView — Cluster Rankings |
| **Action** | Hover cursor over the "mini-todo" row to highlight it. Move cursor slowly along the row to highlight health score, CPU/memory bars, and the "Healthy" governance badge. |
| **Expected Visual** | Row highlights on hover. Health score "95/100" visible. CPU: 38%, Memory: 45% dual progress bar. "0 Active Incidents". "Healthy" green badge. |
| **Retake Condition** | Row hover does not highlight; table is empty |
| **Backend?** | None |

---

### Shot 037 — Switch to Team Members Tab
| Field | Value |
|---|---|
| **Shot** | 037 |
| **Timestamp** | 2:28 – 2:30 |
| **Duration** | 2s |
| **Screen** | LeaderboardView — tab toggle |
| **Action** | Click the **"Team Members"** tab in the top-right toggle. |
| **Expected Visual** | Members leaderboard: Pranav (985, Gold, 14-day streak), Vinit (940, Silver), Neha (915, Bronze), Ishika (890, Participant). |
| **Retake Condition** | Tab toggle does not switch; members table is empty |
| **Backend?** | None |

---

### Shot 038 — Navigate to Settings
| Field | Value |
|---|---|
| **Shot** | 038 |
| **Timestamp** | 2:36 – 2:38 |
| **Duration** | 2s |
| **Screen** | LeftSidebar → Settings view |
| **Action** | Click the **cog icon** (fifth icon in LeftSidebar). |
| **Expected Visual** | SettingsView with three cards: Kubeconfig Vault, RBAC, Access Tokens. |
| **Retake Condition** | Wrong view |
| **Backend?** | None |

---

### Shot 039 — Settings Info Cards
| Field | Value |
|---|---|
| **Shot** | 039 |
| **Timestamp** | 2:38 – 2:41 |
| **Duration** | 3s |
| **Screen** | SettingsView — info cards |
| **Action** | Move cursor slowly over the Kubeconfig Vault card (shows "ENCRYPTED" badge) and RBAC card (shows "ACTIVE (ADMIN)" badge). No clicks. |
| **Expected Visual** | Two info cards with colored badges visible. |
| **Retake Condition** | Cards are not visible due to scroll position |
| **Backend?** | None |

---

### Shot 040 — Generate API Token
| Field | Value |
|---|---|
| **Shot** | 040 |
| **Timestamp** | 2:41 – 2:44 |
| **Duration** | 3s |
| **Screen** | SettingsView — token generation |
| **Action** | Click **"Generate Token"** button. Modal opens. Type "ci-agent" in the token name field. Click **"Generate"**. |
| **Expected Visual** | Modal with name input. After click: modal closes, new token row appears in the list with truncated token string. |
| **Retake Condition** | Modal does not open; token does not appear |
| **Backend?** | None |

---

### Shot 041 — Copy Token
| Field | Value |
|---|---|
| **Shot** | 041 |
| **Timestamp** | 2:44 – 2:45 |
| **Duration** | 1s |
| **Screen** | SettingsView — token row |
| **Action** | Click the **copy icon** next to the token string. |
| **Expected Visual** | Copy icon changes to a checkmark "Copied!" for 2 seconds. |
| **Retake Condition** | Copy icon is not visible |
| **Backend?** | None |

---

## PHASE D — Closing Shots

---

### Shot 042 — Return to Topology + Closing Pan
| Field | Value |
|---|---|
| **Shot** | 042 |
| **Timestamp** | 2:45 – 3:00 |
| **Duration** | 15s |
| **Screen** | Topology canvas — full wide view |
| **Action** | 1. Click the topology (hub) icon in LeftSidebar to return to the canvas. 2. Click "Recenter View" to fit entire graph on screen. 3. Hold still for 5 seconds. 4. Slowly pan left-to-right across the graph using the pan tool (hold middle mouse / hold Space + drag). 5. Hold on a clean wide view. Fade to black for post-production title card. |
| **Expected Visual** | Full populated topology: Ingress node → edges → Services → Workloads → Pods. All nodes labeled. Green CONNECTED status in TopNavbar. |
| **Retake Condition** | Canvas is empty (streamer dropped connection during filming); graph panning is jerky; nodes are out of frame |
| **Backend?** | Go streamer |

---

### Shot 043 — Closing Title Card (Post-Production)
| Field | Value |
|---|---|
| **Shot** | 043 |
| **Timestamp** | 3:00 – 3:10 |
| **Duration** | 10s (fade in over last 2s of 042) |
| **Screen** | Post-production title card |
| **Action** | Created in video editor |
| **Expected Visual** | `#09090B` background. "EnvScale" large heading. "Visual Kubernetes Observability & Governance". "Semester 5 Engineering Project · 2026". Team names listed. Fade to black. |
| **Retake Condition** | N/A |
| **Backend?** | None |

---

## Retake Priority Guide

| Priority | Reason | Action |
|---|---|---|
| **P0** | Shot is visually broken (black screen, glitch, crash) | Discard and redo immediately |
| **P1** | Sensitive information exposed (file paths, tokens, passwords) | Discard and redo before any sharing |
| **P1** | Wrong view is active | Redo segment |
| **P2** | Action is too fast to follow | Re-record at slower pace |
| **P2** | Mouse hover missed the target | Re-record with cursor-highlight tool enabled |
| **P3** | Data shows 0% where live data was expected | Acceptable — narrate around it or retake if time allows |
| **P4** | Minor UI jitter or animation imperfection | Acceptable for a project defense demo |
