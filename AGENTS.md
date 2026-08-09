# EnvScale — AI Assistant System Rules & Governance Guardrails

> **Target Audience:** All AI Coding Assistants (Antigravity, Cursor, Copilot, Claude Code, Windsurf) working on the **EnvScale** repository.  
> **Purpose:** Enforce strict architectural consistency, role-based task divisions, tech stack compliance, and code quality guardrails across all developer environments.

---

## 1. Project Context & High-Level Architecture

**EnvScale** is a Multi-Tenant Kubernetes Observability & Gamified Governance Platform built for engineering teams running microservices on Kubernetes.

### Monorepo Structure
```text
EnvScale/
├── apps/
│   ├── web/               # React + TypeScript + Tailwind + React Flow + Zustand (Neha & Ishika)
│   ├── k8s-streamer/      # Go / Node.js WebSocket & client-go Informer Gateway (Pranav)
│   └── api-server/        # REST CRUD API Engine + Drizzle ORM + PostgreSQL + Redis (Vinit)
├── packages/              # Shared monorepo packages (tsconfig, types, lint)
├── docs/                  # Project SRS, Milestones, Architecture Docs (Ishika)
└── .agents/AGENTS.md      # Repository AI Guardrails & System Rules
```

---

## 2. Strict Team Member Role & Task Matrix

AI Assistants MUST respect and align code deliverables to the specific developer owning the module:

1. **Pranav (Architecture & Core System Engine):**
   - Monorepo infrastructure setup (`pnpm-workspace.yaml`, `turbo.json`).
   - `apps/k8s-streamer`: Go / Node.js WebSocket streaming gateway.
   - Kubernetes Client API integration (`client-go` / `@kubernetes/client-node`).
   - Kubernetes `SharedInformerFactory` (`PodInformer`, `NodeInformer`, `ServiceInformer`).
   - Live pod stdout/stderr log-tailing pipeline (`kubectl logs -f`).
   - Chaos fault injection testing engine (`apps/k8s-streamer/pkg/chaos`).

2. **Vinit (Backend CRUD & API Layer):**
   - PostgreSQL database setup and Drizzle ORM schemas (`apps/api-server/src/db/schema.ts`).
   - REST API endpoints for Workspaces, Member RBAC (`ADMIN`, `MEMBER`, `VIEWER`), Custom Alert Policies, and Incident Logs.
   - AES-256-GCM encryption/decryption module for `Kubeconfig` secrets vault.
   - Dynamic Cluster Health Index algorithm backend and Leaderboard DB queries.

3. **Neha (Frontend UI & Visualization Engine):**
   - `apps/web`: React + Vite + TypeScript + Tailwind CSS application shell.
   - React Flow visual topology canvas (`K8sNode`, `K8sPod`, `K8sService` custom graph nodes with Dagre auto-layout).
   - Real-time streaming Zustand store (`useTopologyStore`) and `useK8sStream` WebSocket hook.
   - Live pod metric inspector drawer, Alert Rule Configuration UI, and Leaderboard view.

4. **Ishika (UI Polish, Static Pages & Quality Assurance):**
   - Step-by-step "Connect Cluster" onboarding wizard UI.
   - Reusable UI component library (`Button`, `Modal`, `Badge`, `Card`, `Toast`).
   - Empty-state UI states and error boundaries.
   - Black-box QA test execution matrix and bug logs.
   - IEEE format SRS Document, Semester 5 Project Report, PPT Defense Deck, and 3-minute video demo.

---

## 3. Technology Stack & Framework Rules

When generating code or proposing implementations, AI assistants MUST strictly adhere to the following stack:

| Component | Allowed Technologies | Prohibited Choices |
| :--- | :--- | :--- |
| **Frontend** | React, TypeScript, Tailwind CSS, Vite, React Flow (`@xyflow/react`), Zustand, Lucide Icons | Plain JS, Bootstrap, Options API, Redux Toolkit, Tailwind v2 |
| **Streaming Gateway** | Go (`client-go`, Gorilla WebSocket) OR Node.js (TypeScript) | Polling loops, REST-only sync for metrics |
| **REST API Engine** | Node.js Express (TypeScript) or Go REST APIs | Plain JS, Python, un-typed Express |
| **Database & ORM** | PostgreSQL, Drizzle ORM | Raw SQL strings without Drizzle, MongoDB, Prisma |
| **Event Bus & Cache** | Redis (Pub/Sub for WebSocket scaling) | In-memory global maps across processes |
| **Local K8s Target** | Minikube, K3s | Direct production edits without local verification |
| **Cloud Target** | AWS EKS | - |

---

## 4. Development & Coding Guardrails

### Security & Data Protection
- **AES-256-GCM Encryption:** NEVER store raw `Kubeconfig` files or secrets as plain text in database columns or logs. Always pass Kubeconfig payloads through the AES-256 encryption helper before database insertion.
- **RBAC Enforcement:** EVERY REST API route in `api-server` must enforce JWT authentication middleware and Workspace Access Guards (`ADMIN`, `MEMBER`, `VIEWER`).
- **Input Validation:** Use Zod schemas for validating all API request payloads.

### Code Quality & Engineering Integrity
- **No Inferred Schemas:** Never guess Drizzle database table definitions or API contracts. Always inspect `apps/api-server/src/db/schema.ts` and shared type definitions first.
- **No Silent Error Swallowing:** Do NOT wrap code in silent `try/catch` blocks that return empty fallback arrays or fake data. Log real errors and surface actionable feedback via standard API responses or toast notifications.
- **Sub-Second Streaming:** Ensure WebSocket state deltas (`EVENT_POD_STATUS_CHANGED`, `EVENT_NODE_MUTATED`) deliver payload updates to the React Flow Zustand store within < 200ms.
- **Preserve Documentation:** Do not erase docstrings, inline comments, or existing README/milestones files.

---

## 5. Verification & Testing Requirements

Before declaring any task or feature complete, the AI assistant MUST verify:
1. **Monorepo Build:** Run `pnpm build` to confirm zero TypeScript compilation errors.
2. **Lint Cleanliness:** Run `pnpm lint` to ensure zero ESLint violations.
3. **Database Consistency:** Run `drizzle-kit check` or migration scripts to verify schema sync.
4. **Milestone Alignment:** Ensure deliverables strictly conform to the 16-week timeline detailed in `docs/milestones.md`.
