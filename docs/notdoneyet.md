# EnvScale Feature Completion Matrix & Visual Gap Roadmap (`notdoneyet.md`)

Structured tracking matrix of completed capabilities vs. pending features across Kubernetes abstractions, visual observability, and infrastructure engines in **EnvScale**.

---

## 1. 📦 Compute & Workload Subtypes

* **[x] DaemonSets:** Host-agent placement & health surfaced per physical node; resident daemon agent badges on worker node cards (`K8sWorkerNode`); detailed per-node distribution grid in inspector drawer (`DaemonSetOverviewSection`).
* **[x] Jobs & CronJobs:** Dedicated canvas cards (`K8sJobNode`, `K8sCronJobNode`) for run-to-completion batch tasks with real-time lifecycle tracking, completion progress, execution duration timer, collapsible completed jobs summary (`K8sCompletedJobsNode`), and CronJob child job filtering.
* **[x] ReplicaSets (Direct) & Rollback Engine:** Revision history cards with image tags, age, replica counts, and authenticated 1-click Rollback endpoint (`POST /api/v1/clusters/:id/rollout/rollback`) featuring JWT Auth Guard, `retry.RetryOnConflict`, and audit logging.
* **[x] Static Pods & Mirror Pods:** Kubelet control plane pod detection (`kubernetes.io/config.mirror` / well-known components) with visual `CP` badge on canvas pods and static mirror pod drawer callout.
* **[x] StatefulSets (Dedicated Headless Clustering & Identity Control Board):** Digital infrastructure control board (`K8sStatefulSetNode`) representing persistent ordinal identities (`pod-0`, `pod-1`), invariant 1:1 bound volume claim templates per ordinal replica (`StatefulOrdinalBlade`), governing Headless Service direct SRV/A-record DNS directory (`StatefulDnsDirectory`), and controller desired vs observed reconciliation.

---

## 2. 💾 Storage & Persistent Volumes

* **[x] PersistentVolumeClaims (PVCs):** Dedicated React Flow canvas nodes (`K8sPVCNode`) displaying capacity, phase (`Bound`, `Pending`, `Lost`), access modes (`RWO`, `RWX`), and StorageClass badges. Real-time pod mount edges (`Pod -> PVC`) with container mount paths (e.g., `:/var/lib/postgresql/data`).
* **[x] PersistentVolumes (PVs):** Physical cluster-scoped volume details consolidated in the Inspector Drawer (`StorageOverviewSection`), displaying bound PV names, reclaim policies (`Delete`, `Retain`, `Recycle`), and driver sources (`HostPath`, `CSI`, `NFS`, `Local`).
* **[x] StorageClasses:** Provisioner driver identification and StorageClass metadata surfaced per volume claim card and inspector overview.
* **[x] Volume Snapshots & Recovery:** Dynamic client-go informers in `k8s-streamer` watching `VolumeSnapshot` and `VolumeSnapshotContent` (`snapshot.storage.k8s.io/v1`), sub-200ms WebSocket streaming (`EVENT_VOLUME_SNAPSHOT_*`, `EVENT_VOLUME_SNAPSHOT_CONTENT_*`), point-in-time snapshot status badges and `dataSource` clone provenance tags on canvas cards (`K8sPVCNode`), and deep physical CSI snapshot inspection drawer with clone lineage (`VolumeSnapshotSection`).


---

## 3. ⚙️ Configuration, Secrets & Vault

* **[x] ConfigMaps & Secrets:** Sanitized Informers in `k8s-streamer`, sub-200ms WebSocket streaming (`EVENT_CONFIGMAP_*`, `EVENT_SECRET_*`), workload card key references, and dedicated inspector drawer overview (`ConfigOverviewSection`).
* **[x] Kubeconfig & TLS Secrets Vault:** AES-256-GCM encryption/decryption module for cluster credential storage in `api-server` and TLS secret badges on Ingress cards.
* **[ ] Mutating & Validating Webhooks:** Invisible interceptors that modify or reject API requests before admission.

---

## 4. 🌐 Networking, Traffic Policies & Ingress

* **[x] NetworkPolicies (Telemetry & Policy Enforcement):** Real-time client-go informers, sub-200ms streaming (`EVENT_NETWORKPOLICY_*`), workload card enforcement badge (`POL` shield on `K8sGroupNode`), and dedicated Inspector Drawer section (`NetworkPolicyRolloutSection`) detailing ingress/egress rules, CIDRs, selectors, and port allowances.
* **[ ] NetworkPolicies (Visual Perimeter Overlay):** No interactive canvas-wide visual firewall perimeter boundaries or highlighted blocked vs. permitted inter-microservice link lines.
* **[x] Ingress Controllers & Dynamic Path Routing:** Ingress header cards, domain host tags, TLS secret badges, and `<EdgeLabelRenderer>` path/port badges (`/:80`, `/api:3001`).
* **[x] Endpoints & Service Discovery:** Active matched endpoint calculations (`calculateEdgeHealth`), ClusterIP routing, and live endpoint count badges (`2 Endpoints`).
* **[ ] Gateway API:** Missing next-gen networking abstractions (`Gateway`, `HTTPRoute`, `GRPCRoute`, `ReferenceGrant`).
* **[ ] Endpoints & EndpointSlices:** Only the parent Service is shown; individual `EndpointSlice` routing distributions are omitted.
* **[ ] ExternalName Services:** No visualization of DNS alias pointers routing outside the cluster.

---

## 5. 📈 Scaling, Resource Governance & Scheduling

* **[x] Horizontal Pod Autoscalers (HPA):** Client-go informers (`policy_hpa_informer.go`), live WebSocket streaming (`EVENT_HPA_*`), workload card scaling boundary tags on `K8sGroupNode` (`HPA {min}–{max}` with live CPU% vs. target tooltip), and dedicated Inspector Drawer section (`AutoscalingHPASection`).
* **[x] PodDisruptionBudgets (PDB):** Client-go informers (`pdb_informer.go`), live WebSocket streaming (`EVENT_PDB_*`), workload card disruption markers (`PDB {allowed}` with emerald/amber status states), Inspector Drawer section (`PodDisruptionBudgetSection`), and in-flight disruption tracking chaos safety guardrails (`pkg/chaos/safety.go`).
* **[x] ResourceQuotas & LimitRanges:** Client-go CoreV1 informers (`quota_informer.go`), live WebSocket streaming (`EVENT_RESOURCE_QUOTA_*`, `EVENT_LIMIT_RANGE_*`), workload card quota pressure tags on `K8sGroupNode` (`QUOTA {pct}%` with active utilization tooltip), namespace quota status dots in `NamespaceFilterPill`, and dedicated Inspector Drawer section (`ResourceQuotaSection`) rendering CPU, Memory, and Pod capacity gauges and container limit ranges.
* **[ ] Vertical Pod Autoscalers (VPA):** No automated CPU/memory recommendation or in-place resizing representation.
* **[ ] PriorityClasses:** No indicator of pod scheduling preemption priority (e.g., system-critical vs. best-effort).

---

## 6. 🏗️ Physical & Virtual Infrastructure Topology

* **[x] Worker Node Cards & Placement:** Dedicated `K8sWorkerNode` cards, assigned Node placement calculator (`getNodeAssignment()`), pod IP inspector, and dynamic node uptime tracking.
* **[ ] Kubernetes Node Boundary Boxes:** Pods show their host node as a string in the drawer, but the canvas lacks visual Node grouping bounding boxes, multi-zone boundaries (e.g., `us-east-1a`, `us-east-1b`), or rack layouts.
* **[ ] Taints & Tolerations:** No visual markers showing which nodes reject unscheduled workloads.
* **[ ] Node Affinity / Anti-Affinity & Topology Spread:** No visual links representing pod co-location or anti-affinity distribution rules across zones.

---

## 7. 🔐 Identity, Access & Security (RBAC)

* **[x] Workspace RBAC & Access Guards:** REST API JWT authentication middleware and Workspace Access Guards (`ADMIN`, `MEMBER`, `VIEWER`).
* **[ ] Kubernetes ServiceAccounts:** No representation of in-cluster pod execution identity.
* **[ ] Kubernetes Roles & ClusterRoles:** No visual mapping of API authorization permissions.
* **[ ] Kubernetes RoleBindings & ClusterRoleBindings:** No link lines mapping identities to granted privileges.

---

## 8. 🚀 Custom Resource Definitions (CRDs) & Ecosystem Operators

* **[x] Canary Deployments & Rollout Tracking:** Canary version label tags, `ArgoEdge.tsx`, and revision history comparison with rollback support.
* **[ ] Argo Rollouts (CRD Controller):** Canary steps, blue/green analysis runs, and pause steps.
* **[ ] Cert-Manager:** `Issuer` and `Certificate` lifecycle/expiration statuses.
* **[ ] Service Mesh Resources:** Istio/Linkerd `VirtualService`, `DestinationRule`, `EnvoyFilter`, and mTLS encryption indicators.

---

## 9. 🔌 Cluster Connectivity & Observability Infrastructure

* **[x] Outbound In-Cluster Streaming Agent Runner:** Reverse WebSocket agent gateway (`/ws/agent`) in `k8s-streamer`, enabling private/firewalled Kubernetes clusters to stream informers outbound without exposing public kubeconfig endpoints.
* **[x] Agent Manifest Generation API:** REST endpoint (`GET /api/v1/clusters/:id/agent-manifest`) generating fully configured RBAC and Deployment manifests for one-click deployment.
* **[x] In-Cluster Agent Onboarding Wizard:** Interactive UI wizard in `apps/web` with 1-click `kubectl apply` installation command and live connection handshake detection.
* **[x] Dynamic Cluster Health Index:** TopNavbar dynamic health badge with calculated grade (`A+` through `F`) and numerical score (0–100) based on pod health, restarts, and resource pressure.
* **[x] Non-Destructive Hybrid Drag Layout:** Hybrid layout engine persisting user-dragged node coordinates across browser reloads, WS re-syncs, and cluster reconnects.

---

## 10. 📜 Real-Time Pod Logging & Terminal Engine

* **[x] Live Pod Log Tailing (`kubectl logs -f`):** Sub-second WebSocket log streaming pipeline (`/ws/logs` in `k8s-streamer`), interactive terminal drawer (`TerminalDrawer.tsx` / `PodLogsTab.tsx`) with log line filtering, search, and immediate regex anomaly detection for `OOMKilled` and `ImagePullBackOff`.
* **[ ] Multi-Pod Aggregated Log Streaming:** Interleaved log tailing across multiple replica pods in a workload group simultaneously.

---

## 11. 💥 Chaos Fault Injection & Resilience Testing

* **[x] Chaos Engineering Engine (`pkg/chaos`):** Fault injection endpoints (`/api/v1/chaos/inject`, `/api/v1/chaos/heal`, `/api/v1/chaos/active`), Pod Kill, CPU Spike, Memory Pressure, Network Latency, and Scaledown faults, PDB safety guardrails (`pkg/chaos/safety.go`), real-time crimson visual cues on canvas workload cards, and 1-click active faults healing in the Inspector Drawer.
* **[ ] Scheduled & Automated Chaos Experiments:** Recurring chaos schedule engine without manual operator trigger.

---

## 12. 📊 Continuous Cluster Metrics Streaming & Telemetry

* **[x] Continuous Cluster Metrics Streaming:** Background cluster-wide metrics streaming pipeline (`informer_metrics.go`, `/ws/metrics`) in `k8s-streamer`, rolling sparkline buffer in `useMetricsStore.ts`, and real-time visualization in `MetricsView.tsx`.
* **[ ] Long-Term Metrics Time-Series Storage:** Prometheus / Thanos persistent metrics storage retention beyond in-memory rolling buffer.

---

## 13. 🛡️ Alert Policies, Incidents & Gamified Governance

* **[x] Custom Alert Policies & Incident Tracking:** REST CRUD API for custom metric/status alert policies, automated trigger dispatcher in `evaluator_incident_dispatcher.go`, incident resolution lifecycle (`TRIGGERED`, `ACKNOWLEDGED`, `RESOLVED`), and gamified governance `LeaderboardView.tsx` with health scores, crash-free streaks, and ranking badges.
* **[ ] External Webhook Notifications (Slack / PagerDuty):** Dispatching alerts to external notification channels beyond in-app incidents.

---

## 14. ☁️ Multi-Cloud & EKS Production Deployment Suite

* **[x] AWS EKS Terraform & Multi-Cloud Deployment Manifests:** Production Terraform modules for AWS EKS multi-AZ VPC, node groups, IAM roles, and OIDC (`deployment/terraform-eks/`), and 3-tier microservice test manifests (`deployment/eks-todo-app.yaml`).