# Documentation Governance & Anti-Redundancy Rules

## 1. Zero Redundant Documentation Policy
- **No Unprompted Documentation Files:** AI assistants MUST NEVER create new `.md` files unless the user explicitly requests: *"create a file"*, *"save this in a markdown file"*, or similar explicit commands. General inquiries, explanations, summaries, and conceptual walkthroughs must be delivered in the conversation response.
- **Single Source of Truth:** Do not fragment domain knowledge across multiple overlapping files. Use [`docs/README.md`](../../docs/README.md) as the master navigation hub for the modular specification suite under `docs/`:
  - Implementation roadmap & milestones belong exclusively in [`docs/milestones.md`](../../docs/milestones.md).
  - Feature inventory & granular task IDs belong exclusively in [`docs/features.md`](../../docs/features.md).
  - High-level system architecture belongs in [`docs/system-architecture.md`](../../docs/system-architecture.md).
  - Detailed design models (UML, ER diagrams, statecharts, flowcharts) belong in [`docs/detailed-design.md`](../../docs/detailed-design.md).
  - Database schema & auth architecture belong in [`docs/db-and-auth-architecture.md`](../../docs/db-and-auth-architecture.md).
  - UI/UX layout and design tokens belong in [`docs/design.md`](../../docs/design.md).
  - Production & cloud deployment runbook belongs in [`docs/deployment.md`](../../docs/deployment.md).
  - Extended subsystem specifications (`api-and-websocket-reference.md`, `cicd-and-environment-reference.md`, `cluster-lifecycle-and-resilience.md`, `developer-control-center-and-tooling.md`, `frontend-state-and-store-architecture.md`, `frontend-views-and-interactions.md`, `in-cluster-agent-and-onboarding.md`, `k8s-workloads-and-rollouts.md`, `logging-metrics-and-diagnostics.md`, `policies-autoscaling-and-quotas.md`, `storage-and-volume-snapshots.md`, `algorithms.md`, `notdoneyet.md`) are indexed in [`docs/README.md`](../../docs/README.md).
- **Update Instead of Duplicate:** If new architectural details or task breakdowns emerge, update the relevant canonical documentation file rather than introducing a new document.
