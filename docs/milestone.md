# EnvScale — Project Milestones & Implementation Blueprint

This document outlines the step-by-step technical implementation roadmap, component responsibilities, module specifications, and task allocations for the **EnvScale** project.

---

## Team Task Matrix

| Team Member | Primary Workstream | Key Modules / Services |
| :--- | :--- | :--- |
| **Pranav** | Core Platform & Orchestration | Go (Gin) API Gateway, Terraform Executor, Docker/K8s Runner, DB Schema |
| **Neha** | AI Infrastructure Agent | CrewAI Agent, LLM Prompt Guardrails, IaC Template Generator & Validator |
| **Vinit** | AIOps Telemetry & ML | ELK/Prometheus Ingestion Pipeline, Isolation Forest Anomaly ML Model |
| **Ishika** | Frontend UI & Cost Engine | React (Vite) Control Plane, WebSockets Live Telemetry, AWS Cost Reaper Bot |

---

## Milestone 1: Foundation & Monorepo Infrastructure Setup

### Objectives
Establish the repository structure, local developer environment, core database schema, and base service boilerplates so all 4 team members can build in parallel without merge conflicts.

### Implementation Details
1. **Monorepo Directory Setup**:
   ```
   EnvScale/
   ├── docs/                   # Product docs, specs & milestones
   ├── frontend/               # React + Vite + TypeScript + Tailwind CSS
   ├── services/
   │   ├── gateway/            # Go (Gin) REST API & WebSockets server
   │   ├── ai-agent/           # Python (CrewAI) Infrastructure Agent
   │   ├── aiops-telemetry/    # Python (Scikit-Learn) Isolation Forest service
   │   └── cost-reaper/        # Python / Go Cloud Cost Optimization Engine
   ├── infra/
   │   ├── docker/             # Local Docker Compose development setup
   │   ├── terraform/          # Base Terraform templates
   │   └── k8s/                # Helm charts / K8s manifests
   └── docker-compose.yml     # One-command developer environment
   ```

2. **Local Environment Stack (`docker-compose.yml`)**:
   - **PostgreSQL 16**: App state storage.
   - **Redis 7**: Real-time task queue & Pub/Sub event bus.
   - **LocalStack**: AWS local emulator (S3, Lambda, IAM for testing IaC).

3. **Core Database Schema (PostgreSQL)**:
   - **`users`**: User profiles & roles.
   - **`environments`**: Staging cluster metadata (`id`, `name`, `status`, `owner_id`, `ttl_hours`, `config_json`, `last_activity_at`).
   - **`agent_logs`**: Step-by-step execution stream from CrewAI & Terraform.
   - **`telemetry_anomalies`**: Anomaly detection history and metric snapshots.
   - **`cost_savings`**: Hourly cost metrics and total USD saved by auto-reaping.

### Deliverables & Success Criteria
- [x] All service skeletons initialized with standard dependencies (`go.mod`, `requirements.txt`, `package.json`).
- [x] `docker-compose up` spins up Postgres, Redis, and LocalStack cleanly.
- [x] Database migration scripts ready and executable.

---

## Milestone 2: Natural Language Infrastructure Agent & Core Gateway API

### Objectives
Enable developers to submit plain-text infrastructure requests (e.g., *"Spin up a staging cluster for auth with Redis and Postgres"*) and translate them into validated, structured infrastructure parameters.

### Implementation Details

1. **CrewAI Infrastructure Agent (`services/ai-agent`)**:
   - Built with **Python** & **CrewAI framework**.
   - Input: Natural language string.
   - Tasks:
     - `IntentParserTask`: Extracts service types, dependencies, environment variables, port mappings, and memory/CPU quotas.
     - `IaCValidatorTask`: Validates requested resources against pre-approved modular templates (prevents unsafe arbitrary code execution).
   - Output: Validated JSON payload matching `IaCConfigSpec`.

2. **Go Gateway API (`services/gateway`)**:
   - Endpoint: `POST /api/v1/environments/provision`
   - Workflow:
     1. Accepts user prompt from frontend.
     2. Calls `ai-agent` microservice via HTTP/gRPC.
     3. Saves initial environment record in PostgreSQL with status `PROVISIONING`.
     4. Emits provisioning job event to Redis queue.

### Deliverables & Success Criteria
- [x] `ai-agent` accepts prompts and returns strict JSON configurations.
- [x] Gateway API validates requests and persists environment state in DB.
- [x] Unit tests cover prompt parsing accuracy (>90% success rate on sample queries).

---

## Milestone 3: Dynamic Provisioning Engine & WebSockets Control Plane

### Objectives
Turn the JSON infrastructure configuration into real, running containers/clusters using Terraform & Docker, while streaming live logs to the React frontend UI.

### Implementation Details

1. **Terraform Execution Engine (`services/gateway/runner`)**:
   - Utilizes pre-validated modular Terraform templates (`infra/terraform/modules/`):
     - `web_service` (Docker container / K8s deployment)
     - `redis_cache` (Redis instance)
     - `postgres_db` (Postgres database)
   - Go process executes Terraform via subprocess:
     ```bash
     terraform init -no-color
     terraform apply -auto-approve -var-file=generated_vars.tfvars.json
     ```
   - Captures stdout/stderr in real-time.

2. **Live WebSocket Stream (`services/gateway/ws`)**:
   - Endpoint: `WS /ws/environments/{id}/logs`
   - Streams live build steps (`CrewAI parsing` -> `Terraform init` -> `Terraform apply` -> `Container running`) directly to the connected React client.

3. **Frontend Dashboard (`frontend/src`)**:
   - Built with React, Vite, TypeScript, and Tailwind CSS.
   - Includes:
     - **Interactive Prompt Console**: Input field with live agent status feed.
     - **Environment Lifecycle Cards**: Visual indicators for `PROVISIONING`, `ACTIVE`, `IDLE`, `TERMINATED`.
     - **Terminal Log Viewer**: Dark-themed streaming log window.

### Deliverables & Success Criteria
- [x] Submitting a prompt successfully provisions local Docker containers or K8s namespaces via Terraform.
- [x] Frontend displays live terminal outputs with <50ms WebSocket latency.
- [x] Clean tear-down capability (`terraform destroy`) via `DELETE /api/v1/environments/{id}`.

---

## Milestone 4: AIOps Telemetry & Isolation Forest Anomaly Detection

### Objectives
Continuously monitor running staging environments for silent memory leaks, creeping latency, and anomalous log patterns using Machine Learning.

### Implementation Details

1. **Telemetry Data Pipeline (`services/aiops-telemetry`)**:
   - Ingests metrics from Prometheus / ELK:
     - CPU utilization slope
     - Memory growth rate ($\Delta \text{RAM} / \Delta t$)
     - Latency 95th percentile ($P_{95}$)
     - 5xx HTTP Error Rate per minute
   - Normalizes feature vectors into a sliding time window (5-minute rolling averages).

2. **Isolation Forest Machine Learning Model**:
   - Built with **Python (Scikit-Learn)**.
   - Pre-trained on baseline normal telemetry; updated continuously.
   - Generates an Anomaly Score $S \in [-1, 1]$ (Scores $< -0.2$ indicate high probability of an anomaly).

3. **Alert Dispatch & Visualization**:
   - Emits anomaly alerts to Redis channel `telemetry:anomalies`.
   - Go Gateway consumes Redis alert and broadcasts a high-priority WebSocket notification to the frontend.
   - React UI displays a red warning toast and pinpoints the exact service and metric anomaly.

### Deliverables & Success Criteria
- [x] Isolation Forest model detects simulated memory leaks within 2 minutes of injection.
- [x] Real-time anomaly alerts displayed in the React dashboard with metric context.

---

## Milestone 5: Automated Cost Reaper Bot & Production Readiness

### Objectives
Automatically identify and tear down idle staging environments to prevent wasted cloud spending, and finalize the system for production deployment.

### Implementation Details

1. **Cost Reaper Engine (`services/cost-reaper`)**:
   - Background worker running on a 15-minute cron interval.
   - Evaluation Logic:
     - Checks last incoming request timestamp (`last_activity_at`).
     - Checks active environment TTL (Time-To-Live expiration).
     - If `current_time > last_activity + TTL` or traffic == 0 for >2 hours:
       1. Triggers automatic `terraform destroy`.
       2. Updates status to `REAPED`.
       3. Calculates cloud cost savings based on instance rate cards ($USD saved / hour).

2. **Cost Analytics Dashboard Widget (`frontend/src/components/CostWidget`)**:
   - Displays real-time metrics:
     - Total Staging Environments Created
     - Idle Hours Eliminated
     - Total USD Saved ($)
     - Resource Utilization Heatmap

3. **Final Polish & Verification**:
   - End-to-end integration testing across all 5 milestones.
   - Security hardening: sanitize inputs to CrewAI and restrict Terraform command flags.

### Deliverables & Success Criteria
- [x] Cost Reaper automatically tears down inactive staging environments after TTL expiry.
- [x] Dashboard reflects accurate cumulative dollar savings.
- [x] End-to-end user demo script validated.
