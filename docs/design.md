# EnvScale — UI & UX Design System Specification

> **Document Purpose:** Single source of truth for the **EnvScale** frontend design system, component layout architecture, graphic canvas guidelines, and color tokens.  
> **Target Scope:** `apps/web` (React + Vite + Tailwind CSS + React Flow + Zustand) owned by **Neha** & **Ishika**.

---

## 1. Core Aesthetic Philosophy & Design Rules

EnvScale is an enterprise-grade Kubernetes Observability and Gamified Governance platform. Its interface must feel extremely modern, crisp, and high-performance—similar to industry-leading developer tools like **Linear**, **Vercel**, and **Datadog**.

### 🚫 Strict Anti-Neon Rule (Prohibited Styles)
- **NO Tacky Neon Glows**: Do NOT use radioactive neon drop-shadows, overly bright neon borders, or garish cyberpunk aesthetic glows around nodes or sidebars.
- **NO Unreadable Dark Mode Contrast**: Avoid low-contrast dark-grey on black text or neon green text on dark backgrounds.
- **NO Distracting Laser Animations**: Canvas edges and status indicators must use subtle, professional micro-animations—not flashy laser beam effects.

### ✅ Enterprise Graphic Guidelines
- **Clean Floating Capsules**: Header Navbar and Navigation Sidebar float seamlessly as rounded capsule elements over a dark grid canvas.
- **High-Contrast Dark Canvas**: Deep matte canvas backdrop (`#09090b`) with a subtle, non-intrusive 20px engineering grid.
- **Frosted Glassmorphism**: Glass surfaces use clean backdrop blur (`backdrop-blur-md`) with ultra-thin neutral borders (`border-neutral-800/80`).
- **Precision Typography**: Clean, legible typography using **Inter** / **Outfit** with strict hierarchy and uppercase status badges.

---

## 2. Layout Architecture & Component Hierarchy

The main application screen follows a 3-region floating layout:

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ [cluster_1 ▾]                            🟢 Connected  🔔  🔀  👤 Profile│  │  <-- Top Floating Navbar Capsule
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ┌──────────┐   ┌────────────────────────────────────────────────────────────┐  │
│  │  🔀 Graph│   │                                                            │  │
│  │  ⚠️ Alert│   │                                                            │  │
│  │  📈 Metric│   │         React Flow Topology Canvas (Grid Backdrop)         │  │  <-- Main Center Canvas
│  │  📄 Logs │   │                                                            │  │
│  │  ⚙️ Sett │   │                                                            │  │
│  └──────────┘   └────────────────────────────────────────────────────────────┘  │
│       ^                                                                         │
│   Left Sidebar Capsule                                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Region 1: Top Floating Navbar Capsule
- **Container**: `fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-full bg-neutral-900/80 backdrop-blur-md border border-neutral-800 px-6 py-2 shadow-2xl`
- **Left Group**:
  - **Workspace & Cluster Selector Dropdown**: Pill dropdown displaying active cluster name (e.g. `cluster_1 ▾` or `minikube-prod`). Includes a `+ Connect New Cluster` action item at the bottom of the list.
- **Right Group**:
  - **Live WebSocket Status Indicator**: Pulsing emerald dot (`🟢 Connected (12ms)`).
  - **Active Incidents Bell**: `🔔` icon with dynamic red counter badge for active pod alerts.
  - **Topology View Toggle**: `🔀` icon to reset/center the graph canvas layout.
  - **User Profile & Settings**: `👤` avatar menu for workspace members.

### Region 2: Left Floating Sidebar Capsule
- **Container**: `fixed left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col rounded-3xl bg-neutral-900/80 backdrop-blur-md border border-neutral-800 p-3 gap-4 shadow-xl`
- **Navigation Icons**:
  1. `🔀` **Topology View**: Main React Flow visual graph.
  2. `⚠️` **Incidents & Alert Policies**: Active alerts, severity logs, and threshold rules.
  3. `📈` **Metrics Inspector**: CPU, Memory, and Pod restart analytics.
  4. `🏆` **Gamified Leaderboard**: Cluster Health Index score, streaks, and member rankings.
  5. `⚙️` **Workspace Settings**: RBAC permissions, encrypted Kubeconfig vault, and API keys.

### Region 3: Center React Flow Canvas
- **Backdrop**: `#09090b` matte dark canvas with custom React Flow `<Background variant="dots" gap={20} size={1} color="#27272a" />`.
- **Controls**: Minimalist zoom/pan controls anchored to the bottom-left of the canvas.

### Region 4: Right Slide-out Inspector Drawer (Contextual)
- **Container**: Slides out smoothly from the right (`width: 420px`) when any custom K8s node or pod on the canvas is clicked.
- **Content Panels**:
  - **Overview**: Pod status, namespace, IP address, restarts count, node assignment.
  - **Live Logs**: Real-time streaming stdout/stderr log tailing console (`kubectl logs -f`).
  - **Resource Usage**: Sparkline charts for CPU usage (`mcores`) and Memory consumption (`MiB`).
  - **Chaos Testing Engine**: Action buttons for fault injection (`Simulate Crash`, `Inject Network Latency`, `Trigger OOM`).

---

## 3. Color Tokens & Theme System

All styles are configured via CSS variables and Tailwind CSS tokens in `apps/web/src/index.css`.

| Token Name | Hex Code | Tailwind Equivalent | Purpose / Component Usage |
| :--- | :--- | :--- | :--- |
| `--canvas-bg` | `#09090b` | `bg-neutral-950` | Main canvas background |
| `--grid-dot` | `#27272a` | `color-neutral-800` | Background grid dot pattern |
| `--surface-capsule` | `rgba(23, 23, 23, 0.85)` | `bg-neutral-900/85` | Navbar & Sidebar capsule background |
| `--surface-card` | `#141417` | `bg-neutral-900` | Node card & Drawer background |
| `--border-subtle` | `#27272a` | `border-neutral-800` | Standard component border |
| `--status-running` | `#10b981` | `text-emerald-500` | Healthy Pod / Connected WS indicator |
| `--status-warning` | `#f59e0b` | `text-amber-500` | Pending Pod / High CPU warning |
| `--status-error` | `#ef4444` | `text-red-500` | CrashLoopBackOff / Failed Pod alert |
| `--status-inactive` | `#6b7280` | `text-neutral-500` | Terminated / Unknown status |
| `--accent-primary` | `#3b82f6` | `bg-blue-500` | Primary action buttons & selected states |

---

## 4. Custom React Flow Node Designs

Custom nodes in `apps/web/src/components/canvas/` must follow professional graphic card guidelines:

### A. `K8sNode` (Kubernetes Worker Node)
- Large container node representing a physical/virtual K8s node (e.g. `minikube-worker-1`).
- Displays node IP, OS image, total CPU/Memory capacity gauges, and contains/connects child Pods.
- Border turns subtle amber/red if node CPU/Memory capacity exceeds 85%.

### B. `K8sPod` (Kubernetes Pod Workload)
- Compact rectangular card (`220px x 80px`) with rounded corners (`rounded-xl`).
- **Header**: Pod name (truncated with ellipsis), namespace badge (e.g., `default`, `kube-system`).
- **Body**: Status indicator dot, status text (`Running`, `CrashLoopBackOff`), restart count badge (`Restarts: 3`).
- **Handles**: Left handle for target service connection, right handle for outbound dependencies.

### C. `K8sService` (Kubernetes Service / Ingress)
- Pill-shaped node (`rounded-full`) representing Ingress / ClusterIP / LoadBalancer endpoints.
- Displays target port (e.g., `:8080`, `:443`) and routes traffic to matching Pod selectors.

### D. Graph Edge Styling
- Edge type: `smoothstep` with radius `12`.
- Base stroke color: `#3f3f46` (Neutral 700), width `2px`.
- Active traffic edge: Animated subtle stroke dash array (`stroke-dasharray: 5`, duration `1.5s`) for active request flows.

---

## 5. Typography & Micro-Interactions

- **Font Family**: Inter, system-ui, sans-serif.
- **Button Hover States**: `hover:bg-neutral-800 transition-all duration-200 ease-out active:scale-95`.
- **Node Selection Highlight**: Selected node receives a crisp 2px primary border (`border-blue-500`) without glow effects.
- **Drawer Motion**: Smooth slide-in transition (`transition-transform duration-300 ease-in-out`).

---

## 6. Implementation Checklist for Neha & Ishika

- [ ] Update `apps/web/src/index.css` with core color tokens and glassmorphism utility classes.
- [ ] Implement `TopNavbar.tsx` capsule component with workspace/cluster dropdown.
- [ ] Implement `LeftSidebar.tsx` floating icon navigation capsule.
- [ ] Build custom React Flow graph nodes (`K8sNode.tsx`, `K8sPod.tsx`, `K8sService.tsx`).
- [ ] Implement Dagre auto-layout graph utility (`apps/web/src/utils/layout.ts`).
- [ ] Build `PodInspectorDrawer.tsx` slide-out panel with live log tailing console.
