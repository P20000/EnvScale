# EnvScale — Multi-Tenant Kubernetes Observability & Gamified Governance Platform

**Team Members:** Pranav Dwivedi, Neha Sharma, Vinit, Ishika

---

## Elevator Pitch

**The Real-World Problem:**

Modern engineering teams running microservices on Kubernetes face severe operational blind spots. Infrastructure health is buried in opaque CLI outputs (`kubectl`), alerting requires complex enterprise setups, and developers lack immediate visual feedback when pods enter crash loops or consume excess CPU. Existing tools either offer zero persistent state management or carry immense enterprise setup complexity, leaving teams struggling to track infrastructure stability across multiple staging and production environments.

**The Solution:**

**EnvScale** is a multi-tenant Kubernetes observability and governance platform. It transforms raw cluster metrics into an interactive real-time visual canvas, enforces custom user-defined alert policies, and gamifies infrastructure stability through automated cluster health scoring and uptime leaderboards.

---

## Base Features & Platform Core

### 1. Interactive Cluster Topology Engine (Real-Time Canvas)

* **Live Visual Mapping:** Renders Kubernetes Nodes, Pods, and Services as interactive nodes using a drag-and-drop canvas layout.
* **Real-Time Status Streaming:** Utilizes WebSocket / Server-Sent Events (SSE) connections to instantly reflect pod lifecycle state changes (Running, CrashLoopBackOff, Pending) with intuitive color coding (Green, Red, Yellow).
* **Single-Click Diagnostics:** Clicking a node opens an inspector panel displaying live CPU/memory usage and streaming the last 50 error log lines directly from the pod.

### 2. Multi-Tenant Workspace & Infrastructure RBAC (CRUD)

* **Workspace Management:** Allows engineering leads to create isolated workspaces (e.g., Staging, QA, Production) and assign team members with specific roles (Admin, Viewer).
* **Cluster Secret Governance:** Securely stores and manages encrypted `Kubeconfig` credentials in a central database, enabling seamless switching between multiple clusters.

### 3. Custom Alert Policy & Incident Engine (CRUD)

* **Rule Engine Setup:** Users can configure custom metric threshold rules (e.g., *"Trigger Alert if Pod Restarts > 3 within 10 minutes"* or *"Notify if CPU Usage > 85%"*).
* **Incident History Log:** Persists triggered alerts in a central database with resolution tracking, incident timestamps, and severity tagging.

### 4. Gamified Health Scoring & Leaderboard

* **Cluster Health Score (0–100):** Calculates a dynamic stability index based on active pod restarts, memory pressures, and node readiness status.
* **Uptime & Efficiency Leaderboards:** Ranks team workspaces by zero-crash streaks and resource efficiency, incentivizing proactive cluster hygiene.

---

## Tech Stack

* **Frontend:** React, TypeScript, Tailwind CSS, Vite, React Flow (Canvas Graph Visualization), Lucide Icons.
* **Backend & Streaming Gateway:** Go (Golang) / Node.js (TypeScript) for high-performance Kubernetes API streaming via WebSockets and REST API endpoints.
* **Database & ORM:** PostgreSQL, Drizzle ORM / Prisma (User RBAC, Workspaces, Alert Rules, Incident Logs, Leaderboard Scores).
* **Cluster Targets & Orchestration:** Minikube / K3s (Local Development & Testing) and AWS EKS.

---

## Demographics & Psychographics

* **Demographics:**
* **Age:** 22–40
* **Roles:** DevOps Engineers, Platform Engineers, Site Reliability Engineers (SREs), Engineering Leads, and Full-Stack Developers.
* **Company Size:** Fast-growing startups and mid-market tech teams managing multi-container microservice setups.


* **Psychographics:**
* Frustrated by terminal-only Kubernetes interfaces (`kubectl`) during urgent outage debugging.
* Desire instant visual clarity over complex dashboard configuration pipelines.
* Motivated by team collaboration, proactive system stability, and clean developer experience.



---

## Internal Monologue of a Victim

> *"It’s 4:30 PM on a Friday and a microservice just silently went into a CrashLoopBackOff state. I’m running five different `kubectl get pods -n staging` commands across three terminal tabs trying to figure out which container is failing. Meanwhile, our new junior dev accidentally applied a broken config, and I have no easy way to see what altered our cluster topology. I shouldn't have to decipher walls of raw CLI text or set up a bloated enterprise monitoring tool just to know if my staging cluster is actually healthy."*

---

## Repository & Team Task Breakdown

```text
EnvScale/
├── apps/
│   ├── web/               # React + Tailwind + React Flow (Neha & Ishika)
│   │   ├── components/    # Canvas, Dashboards, Leaderboards, Onboarding
│   │   └── pages/         # Workspaces, Alert Rules, Cluster Map
│   │
│   ├── k8s-streamer/      # Go / Node.js WebSocket Engine (Pranav)
│   │   └── client/        # Kubernetes API Client & Real-time Metrics Stream
│   │
│   └── api-server/        # Node.js / Go CRUD Engine (Vinit)
│       ├── controllers/   # Workspaces, Custom Alerts, Leaderboards
│       └── db/            # PostgreSQL / Drizzle Schema & Migrations
│
└── docs/                  # Project Reports, SRS, PPTs (Ishika)

```

### Responsibility Matrix

* **Pranav (Architecture & Core Engine):** Kubernetes API Client integration, Go/Node.js WebSocket metric streaming engine, core real-time state synchronization.
* **Vinit (Backend CRUD & API Layer):** PostgreSQL schema design, Drizzle ORM configuration, REST APIs for Workspaces, User RBAC, Alert Rules, and Leaderboard scoring endpoints.
* **Neha (Frontend System & Visualization):** React Flow canvas integration, node/edge state rendering, Workspace settings UI, and Alert Rule management interfaces.
* **Ishika (UI Polish, Documentation & QA):** User onboarding flows, static help documentation, empty-state UI designs, manual black-box QA logs, SRS report, and presentation assets.