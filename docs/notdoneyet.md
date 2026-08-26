# EnvScale Feature Completion Matrix & Roadmap (`notdoneyet.md`)

Structured checkbox tracking matrix of completed capabilities vs. pending features across Kubernetes abstractions, visual observability, and infrastructure engines in **EnvScale**.

---

## 1. 📦 Compute & Workload Subtypes

- [ ] **DaemonSets:** Representation of node-level system workloads running a replica on every physical node (e.g., Fluentd, Node Exporter, Cilium agents).
- [x] **CronJobs & Batch Tasks:** Visual side-rail cards for scheduled CronJobs (`db-audit-cronjob`) and batch job execution timelines with completion/failure states.
- [x] **ReplicaSets & Deployments:** Direct ReplicaSet revision tracking, active replica capping, and dead/terminated pod hash pruning during container recreations.
- [ ] **Static Pods & Mirror Pods:** Kubelet-managed control plane pods (e.g., `kube-apiserver`, `etcd`, `kube-scheduler`).

---

## 2. 💾 Storage & Persistent Volumes

- [ ] **PersistentVolumeClaims (PVCs):** Visual nodes or links indicating which pods request storage volumes.
- [ ] **PersistentVolumes (PVs):** Representation of actual bound physical storage volumes in the cluster.
- [ ] **StorageClasses:** Indicators for dynamic storage provisioning backends (e.g., AWS EBS `gp3`, Ceph, local-path).
- [ ] **Volume Snapshots:** Representation of `VolumeSnapshot` or `VolumeSnapshotContent` lifecycle states.

---

## 3. ⚙️ Configuration, Secrets & Security Vault

- [ ] **ConfigMaps:** Visual nodes or injection lines showing which workloads consume specific configuration keys.
- [x] **Kubeconfig & TLS Secrets Vault:** AES-256-GCM encryption/decryption engine for Kubeconfig secrets and TLS certificate secret tags in Ingress cards (`ingress-tls-cert`).
- [ ] **Mutating & Validating Webhooks:** Admission controller interceptors that modify or reject API requests before admission.

---

## 4. 🌐 Networking, Ingress & Traffic Policies

- [x] **Ingress Controllers & Dynamic Path Routing:** Ingress header cards, domain host tags, TLS secret badges, and `<EdgeLabelRenderer>` path/port badges (`/:80`, `/api:3001`).
- [x] **Endpoints & Service Discovery:** Service matched active endpoint calculation (`calculateEdgeHealth(svc, groupPods)`), ClusterIP routing, and endpoint count badges (`2 Endpoints`).
- [ ] **NetworkPolicies:** Visual firewall/isolation boundaries indicating blocked or permitted ingress/egress rules between microservices.
- [ ] **Gateway API:** Next-gen networking abstractions (`Gateway`, `HTTPRoute`, `GRPCRoute`, `ReferenceGrant`).
- [ ] **ExternalName Services:** Visualization of DNS alias pointers routing outside the cluster.

---

## 5. ⚡ Connection Edges & Health State Machine

- [x] **Solid Emerald Green Edges (`#10b981`):** Active healthy traffic routing with 100% ready pod endpoints.
- [x] **Solid Crimson Red Edges (`#ef4444`):** Broken route / 0 ready matched endpoints alert state.
- [x] **Solid Amber Edges (`#f59e0b`):** Degraded flow state ($\ge 1$ pod in `CrashLoopBackOff` or `OOMKilled`).
- [x] **Solid Slate Edges (`#475569`):** Idle / unlinked routes.
- [x] **Dynamic Handle Routing (`TB` vs `LR`):** Bezier/Smoothstep edge paths with dynamic `sourcePosition` & `targetPosition` directly from handles.

---

## 6. 📈 Live Telemetry, Log Terminal & Observability Engine

- [x] **Universal WebSocket Streaming Gateway (`apps/k8s-streamer`):** Direct WebSocket endpoint `GET /api/v1/stream/logs` handling Pod stdout/stderr log tailing, Workload multi-pod fan-out log streams, and Service/Ingress event watches.
- [x] **Ingestion-Time JSON Log Parser (`logParser.ts`):** Parses JSON strings once on WebSocket message ingestion, extracting `level`, `message`, `timestamp`, and key-value `attributes`.
- [x] **ANSI Color Sanitization:** Strips ANSI escape codes (`/\x1b\[[0-9;]*[a-zA-Z]/g`) before JSON parsing or plain-text rendering.
- [x] **Timestamp Key Normalization:** Multi-key timestamp extraction across `json.timestamp`, `json.time`, `json['@timestamp']`, `json.asctime`, and `json.ts`.
- [x] **Datadog-Style Interactive Log Terminal (`LogRow.tsx`):** Single-line layout `[Timestamp] [Level Pill] [Pod Tag] [Core Message] [Attribute Chips]` with click-to-expand structured JSON inspection panel and Copy JSON button.
- [x] **Quick Noise Suppressor Toggle (`[ 🔇 Hide Noise: ON ]`):** Suppresses repetitive heartbeat logs (`GET /healthz`, `event="heartbeat"`).
- [x] **Log Line Deduplication:** Collapses consecutive identical log lines into a single row with timestamp ranges (`[09:58:29 – 10:00:09]`) and repetition count badges (`x21`).
- [x] **Direct Canvas Error Highlighting:** Ingestion of `ERROR`/`FATAL` log frames dispatches a critical notification in top navbar and highlights the targeted canvas node.

---

## 7. 💥 Chaos Engineering & Fault Simulation Visuals

- [x] **Real-Time Fault Injector Engine (`pkg/chaos/injector.go`):** Supports `SIGKILL`, `OOM Pressure`, and `Scale Down` fault actions.
- [x] **Sub-200ms WebSocket State Deltas:** State delta events (`EVENT_POD_STATUS_CHANGED`, `EVENT_NODE_MUTATED`) deliver status updates to React Flow Zustand store in < 200ms.
- [x] **Pulsing Status Dots & Badges:** Pod replica pills render pulsing Red dots, **`OOM`** / **`CRASH`** red badges, and increment restart counters (`↺ 1`).

---

## 8. 🛡️ Scaling, Security & Infrastructure Topology

- [x] **Kubernetes Node Assignment & Placement:** Assigned Node placement calculator (`getNodeAssignment()`), Pod IP inspector (`10.244.2.2`), and dynamic uptime tracking.
- [x] **Workspace RBAC & Member Guards:** REST API JWT authentication middleware and Workspace Access Guards (`ADMIN`, `MEMBER`, `VIEWER`).
- [ ] **Horizontal Pod Autoscalers (HPA):** Target metric thresholds (e.g., target CPU 80%) or min/max replica boundaries.
- [ ] **Vertical Pod Autoscalers (VPA):** Automated CPU/memory recommendations or in-place resizing representation.
- [ ] **PodDisruptionBudgets (PDB):** Visual markers showing allowed simultaneous evictions during node drains or chaos experiments.
- [ ] **ResourceQuotas & LimitRanges:** Visual cluster-boundary caps showing max namespace memory, CPU, or pod capacity.

---

## 9. 🚀 Custom Resource Definitions (CRDs) & Ecosystem

- [x] **Argo Rollouts & Canary Deployments:** Canary version label tags, `ArgoEdge.tsx`, and canary deployment visualization (`todo-backend-canary`).
- [ ] **Cert-Manager:** `Issuer` and `Certificate` lifecycle/expiration statuses.
- [ ] **Service Mesh Resources:** Istio/Linkerd `VirtualService`, `DestinationRule`, `EnvoyFilter`, and mTLS encryption indicators.