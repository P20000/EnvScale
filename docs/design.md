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
- **Material Design Iconography System**: All UI navigation controls, node badges, drawers, terminals, and modals strictly consume standardized **Google Material Design Icons** (`react-icons/md`).
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
- **Container**: `fixed top-0 left-0 w-full z-[60] bg-[#141417] border-b border-zinc-800 px-4 h-14`
- **Background Layer**: Contains an isolated, absolute clipping container (`overflow-hidden inset-0`) wrapping an enlarged, spinning intricate SVG mandala. The SVG is meticulously centered onto the EnvScale logo, preventing visual bleed into the main canvas while allowing menus to overflow freely.
- **Left Group**:
  - **Project Branding**: `EnvScaleLogo` and typographic `ENVSCALE` title.
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

All styles are configured via CSS variables and Tailwind CSS tokens in `apps/web/src/index.css` and `apps/web/tailwind.config.js`.

### 3.1. Core Surface & Background Tokens
## 3. Color Tokens & Theme System (Material Design 3 Dark Theme)

All styles are configured via CSS variables and Tailwind CSS tokens in `apps/web/src/index.css` and `apps/web/tailwind.config.js`.

### 3.1. Core Surfaces and Background
| Token | Revised Value | Material 3 Role | Purpose / Usage |
| :--- | :--- | :--- | :--- |
| `--canvas-bg` | `#111318` | Background | Deep matte canvas backdrop |
| `--grid-dot` | `#2B2F36` | Subtle engineering grid | Canvas dot grid pattern |
| `--surface-card` | `#191B20` | Surface container low | Floating cards, drawers, node backgrounds |
| `--surface-panel` | `#23262D` | Surface container high | Elevated popovers, nested sub-panels, tooltips |
| `--surface-group` | `#1E2127` | Surface container | Namespace / Workload parent containers & capsules |
| `--surface-capsule` | `rgba(30, 33, 39, 0.90)` | Translucent elevated surface | Frosted header navbar & sidebar capsule |
| `--border-subtle` | `#30343B` | Subtle structural boundaries | Structural dividers, card borders |
| `--border-default` | `#424750` | Default outlines | Base input & card outline |
| `--border-muted` | `#5C616B` | Emphasized boundaries | Edge lines, secondary boundaries, guide crosshairs |

### 3.2. Text and Foreground Hierarchy
| Token | Revised Value | Material 3 Role | Purpose / Usage |
| :--- | :--- | :--- | :--- |
| `--text-primary` | `#E6E1E5` | On-surface | High-contrast headings and active values |
| `--text-secondary` | `#C4C7C5` | On-surface variant | Subtitles, labels, descriptions |
| `--text-muted` | `#92959D` | De-emphasized text | Placeholders, inactive timestamps, counts |
| `--text-inverted` | `#111318` | Text on light-filled actions | Badges & high-emphasis filled action text |

### 3.3. Workload Health and Status Lifecycle
| Token | Revised Value | Usage |
| :--- | :--- | :--- |
| `--status-running` | `#6DD6A8` | Healthy pods, running workloads, active cluster state |
| `--status-warning` | `#F4C26B` | Pending workloads, degraded health, CPU alert threshold |
| `--status-error` | `#F2B8B5` | Failed pods, crash loops, incidents (paired with `#410E0B` container) |
| `--status-inactive` | `#9AA0AA` | Terminated, completed, unknown states |
| `--status-idle` | `#777D87` | Idle nodes, draining nodes, inactive edges |

### 3.4. Kubernetes Resource Badges and Topology Flow Colors
| Resource / Flow Type | Revised Value | Rationale & Usage |
| :--- | :--- | :--- |
| **Ingress / Route Edge** | `#D0BCFF` | Material 3 tonal purple for ingress routes & controllers |
| **Service (ClusterIP / LB)** | `#8ACBFA` | Softer sky blue for services and ingress linkages |
| **Storage (PV / PVC Bound)** | `#80DEEA` | Clear cyan identity for bound persistent volume claims |
| **Storage (Unbound / Pending)** | `#F4C26B` | Consistent amber for unbound/pending storage semantics |
| **CronJob / Active Batch** | `#F4C26B` | Consistent amber for scheduled work, border beam & progress |
| **Primary Accent / Selection** | `#A8C7FA` | Material-style light blue accent for interactive elements |
| **Selection Focus Ring** | `#D3E3FD` | High-visibility focus indication and handle highlighting |
| **Standard Edge Stroke** | `#515660` | Visible but unobtrusive graph edges |

### 3.5. Material 3 Tonal Action Colors
| Token | Value | Usage |
| :--- | :--- | :--- |
| `--md-primary` | `#A8C7FA` | Primary interactive elements |
| `--md-on-primary` | `#102F50` | Text/icons on primary buttons |
| `--md-primary-container` | `#284568` | Selected node backgrounds |
| `--md-on-primary-container` | `#D3E3FD` | Selected node foreground |
| `--md-secondary` | `#C4C7C5` | Secondary actions |
| `--md-surface-variant` | `#30343B` | Alternative surfaces |
| `--md-outline` | `#8E939D` | Visible component outlines |
| `--md-outline-variant` | `#424750` | Low-emphasis outlines |

---

## 4. Custom React Flow Node Designs

Custom nodes in `apps/web/src/components/canvas/` must follow professional graphic card guidelines:

### A. `K8sGroup` (Nested Hybrid Topology Parent Container)
- Replaces standard independent nodes with a structured, parent container representing Kubernetes groupings (e.g., Namespaces, Workload Deployments).
- **Aesthetic**: Solid structural surface (`bg-[#191B20] border-2 border-[#30343B]`) with sharp, visible heading contrast (`text-[#E6E1E5] font-mono tracking-widest`).
- **Handles**: Enforces absolute strict handle routing—only explicitly defined target (left) and source (right) anchors are allowed. No arbitrary edge routing.

### B. `K8sNode` (Kubernetes Worker Node)
- Large container node representing a physical/virtual K8s node (e.g. `minikube-worker-1`).
- Displays node IP, OS image, total CPU/Memory capacity gauges, and contains/connects child Pods.
- Border turns subtle amber/red if node CPU/Memory capacity exceeds 85%.

### C. `K8sPod` (Kubernetes Pod Workload)
- Compact rectangular card (`208px x 32px`) nesting inside its parent `K8sGroup`.
- **Header**: Pod name (truncated with ellipsis), namespace badge (e.g., `default`, `kube-system`).
- **Body**: Status indicator dot, status text (`Running`, `CrashLoopBackOff`), restart count badge (`Restarts: 3`).
- **Handles**: Inherits connections from its parent group; strictly internal visual representation inside the topology.

### C. `K8sService` (Kubernetes Service / Ingress)
- Pill-shaped node representing Ingress / ClusterIP / LoadBalancer endpoints.
- Displays target port (e.g., `:8080`, `:443`) and routes traffic to matching Pod selectors.

### D. Graph Edge Styling
- Edge type: `argo` or `smoothstep` with radius `8`.
- Base stroke color: `#515660`, width `2px`.
- Active traffic edge: Animated subtle stroke dash array (`stroke-dasharray: 5`, duration `1.5s`) for active request flows.

---

## 5. Typography, Modals, & Micro-Interactions

- **Material Design 3 (M3) Nested Proportions**: Enforce strict harmonic border radiuses across all dialogs and modals. Inner element radii must equal Outer radius minus padding.
- **Surface Reality**: Flat, high-contrast, structurally precise structural layers.
- **Font Family**: Inter, system-ui, sans-serif.
- **Button Hover States**: `hover:bg-[#23262D] transition-all duration-200 ease-out active:scale-95`.
- **Node Selection Highlight**: Selected node receives a crisp 2px primary border (`border-[#A8C7FA]`) with double ring (`#284568` / `#D3E3FD`).
- **Drawer Motion**: Smooth slide-in transition (`transition-transform duration-300 ease-in-out`).

---

## 6. Implementation Checklist for Neha & Ishika

- [ ] Update `apps/web/src/index.css` with core color tokens and glassmorphism utility classes.
- [ ] Implement `TopNavbar.tsx` capsule component with workspace/cluster dropdown.
- [ ] Implement `LeftSidebar.tsx` floating icon navigation capsule.
- [ ] Build custom React Flow graph nodes (`K8sNode.tsx`, `K8sPod.tsx`, `K8sService.tsx`).
- [ ] Implement Dagre auto-layout graph utility (`apps/web/src/utils/layout.ts`).
- [ ] Build `PodInspectorDrawer.tsx` slide-out panel with live log tailing console.
