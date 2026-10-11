# EnvScale — Detailed Design Specification (UML, Flowcharts & ER Diagrams)

> **Document Purpose:** Detailed technical design specification for **EnvScale**, presenting formal Entity-Relationship (ER) diagrams, UML class and sequence models, statecharts, and algorithmic flowcharts.  
> **Audience:** Core System Developers (Pranav, Vinit, Neha, Ishika), Technical Leads, and System Evaluators.  
> **Traceability:** Aligns with [`docs/system-architecture.md`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/docs/system-architecture.md), [`apps/api-server/src/db/schema.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/api-server/src/db/schema.ts), and [`packages/types/src/index.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/packages/types/src/index.ts).

---

## 1. Entity-Relationship (ER) Architecture

The database persistence layer is implemented in PostgreSQL via Drizzle ORM ([`apps/api-server/src/db/schema/`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/api-server/src/db/schema)). The following diagram illustrates all relational entities, column types, primary/foreign keys, and constraints.

```mermaid
erDiagram
    users {
        uuid id PK
        varchar email UK
        varchar name
        boolean email_verified
        text image
        text password_hash
        varchar avatar
        varchar role
        boolean is_active
        timestamp last_login
        timestamp created_at
        timestamp updated_at
    }
    refresh_tokens {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamp expires_at
        timestamp revoked_at
        timestamp created_at
    }
    sessions {
        text id PK
        text token UK
        uuid user_id FK
        timestamp expires_at
        text ip_address
        text user_agent
        timestamp created_at
        timestamp updated_at
    }
    accounts {
        text id PK
        text account_id
        text provider_id
        uuid user_id FK
        text access_token
        text refresh_token
        text id_token
        timestamp access_token_expires_at
        timestamp refresh_token_expires_at
        text scope
        text password
        text issuer
        timestamp created_at
        timestamp updated_at
    }
    workspaces {
        uuid id PK
        varchar name
        varchar slug UK
        text description
        uuid owner_id FK
        varchar logo
        jsonb metadata
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }
    workspace_members {
        uuid workspace_id PK,FK
        uuid user_id PK,FK
        varchar role
        timestamp joined_at
        timestamp updated_at
    }
    clusters {
        uuid id PK
        uuid workspace_id FK
        varchar name
        varchar type
        text kubeconfig
        varchar api_server_url
        varchar version
        integer node_count
        decimal health_score
        varchar status
        timestamp last_sync_at
        jsonb metadata
        timestamp created_at
        timestamp updated_at
    }
    health_snapshots {
        uuid id PK
        uuid cluster_id FK
        decimal health_score
        timestamp timestamp
        jsonb details
        jsonb pod_status
        jsonb node_status
        jsonb network_status
        jsonb storage_status
        decimal uptime
        timestamp created_at
    }
    alert_policies {
        uuid id PK
        uuid workspace_id FK
        uuid cluster_id FK
        varchar name
        text description
        varchar metric
        decimal threshold
        varchar operator
        integer duration
        varchar severity
        boolean is_enabled
        jsonb conditions
        jsonb notification_channels
        uuid created_by FK
        timestamp created_at
        timestamp updated_at
    }
    incidents {
        uuid id PK
        uuid workspace_id FK
        uuid cluster_id FK
        uuid alert_policy_id FK
        varchar title
        text description
        varchar severity
        varchar status
        decimal value
        uuid acknowledged_by FK
        timestamp acknowledged_at
        uuid resolved_by FK
        timestamp resolved_at
        text root_cause
        text resolution
        jsonb related_events
        timestamp created_at
        timestamp updated_at
    }

    users ||--o{ refresh_tokens : "owns"
    users ||--o{ sessions : "establishes"
    users ||--o{ accounts : "authenticates via"
    users ||--o{ workspaces : "creates/owns"
    users ||--o{ workspace_members : "participates in"
    workspaces ||--o{ workspace_members : "contains"
    workspaces ||--o{ clusters : "owns"
    workspaces ||--o{ alert_policies : "configures"
    workspaces ||--o{ incidents : "tracks"
    clusters ||--o{ health_snapshots : "generates"
    clusters ||--o{ alert_policies : "monitored by"
    clusters ||--o{ incidents : "undergoes"
    alert_policies ||--o{ incidents : "triggers"
    users ||--o{ alert_policies : "authors"
    users ||--o{ incidents : "acknowledges"
    users ||--o{ incidents : "resolves"
```

---

## 2. UML Class Diagrams

### 2.1 Backend Services & Data Access Model (`apps/api-server`)

The REST backend encapsulates business rules within decoupled controllers, cryptographic helpers, and background workers.

```mermaid
classDiagram
    class CryptoVault {
        -String algorithm = "aes-256-gcm"
        -Buffer masterKey
        +encrypt(plainText: string): EncryptedPayload
        +decrypt(cipherPayload: EncryptedPayload): string
    }
    class ClusterSyncService {
        +syncClusterWithStreamer(clusterId: string): Promise~boolean~
        +hydrateClustersOnStartup(): Promise~void~
        +verifyStreamerHealth(): Promise~boolean~
    }
    class ClusterReconcileWorker {
        -boolean isReconciling
        -number reconcileIntervalMs
        -NodeJS.Timeout timerHandle
        +start(): void
        +stop(): void
        -reconcileLoop(): Promise~void~
    }
    class HealthCalculatorService {
        +calculateClusterHealth(pods: PodData[], nodes: NodeData[]): number
        +computeUptimePercentage(history: Snapshot[]): number
        +generateSnapshot(clusterId: string): Promise~HealthSnapshot~
    }
    class IncidentService {
        +triggerIncident(payload: CreateIncidentDTO): Promise~Incident~
        +acknowledgeIncident(incidentId: string, userId: string): Promise~Incident~
        +resolveIncident(incidentId: string, userId: string, rootCause: string): Promise~Incident~
        +listWorkspaceIncidents(workspaceId: string): Promise~Incident[]~
    }
    class AlertEvaluator {
        +evaluateMetricRule(policy: AlertPolicy, currentVal: number): boolean
        +dispatchAlertEvent(incident: Incident): Promise~void~
    }

    ClusterSyncService --> CryptoVault : uses for kubeconfig decryption
    ClusterReconcileWorker --> ClusterSyncService : executes sync cycles
    IncidentService --> AlertEvaluator : triggers on threshold breach
```

### 2.2 Go Kubernetes Streaming Gateway Architecture (`apps/k8s-streamer`)

The high-throughput Go gateway manages concurrent WebSocket clients, Informer subscriptions, and the chaos engine.

```mermaid
classDiagram
    class Hub {
        -clients: map[*Client]bool
        -rooms: map[string]map[*Client]bool
        -broadcast: chan WSEventPayload
        -register: chan *Client
        -unregister: chan *Client
        +Run(): void
        +BroadcastToRoom(roomID: string, event: WSEventPayload): void
        +SetPublisher(publisher: RedisPublisher): void
    }
    class Client {
        -hub: *Hub
        -conn: *websocket.Conn
        -send: chan []byte
        -userID: string
        -clusterID: string
        +ReadPump(): void
        +WritePump(): void
    }
    class ClusterManager {
        -clusters: map[string]*InformerManager
        -mu: sync.RWMutex
        +RegisterCluster(clusterID: string, rawKubeconfig: []byte): error
        +GetCluster(clusterID: string): (*InformerManager, error)
        +RemoveCluster(clusterID: string): void
    }
    class InformerManager {
        -clientset: *kubernetes.Clientset
        -factory: informers.SharedInformerFactory
        -stopCh: chan struct{}
        +StartInformers(): void
        +Stop(): void
        +GetPodTopology(): []PodTopologyData
        +GetNodeTopology(): []NodeTopologyData
    }
    class PodLogStreamer {
        -hub: *Hub
        +StreamLogs(ctx: Context, clusterID: string, podName: string, ns: string): error
    }
    class ChaosManager {
        +SimulatePodCrash(clusterID: string, podName: string, ns: string): error
        +InjectNetworkLatency(clusterID: string, podName: string, delayMs: int): error
        +TriggerOOM(clusterID: string, podName: string): error
    }

    Hub "1" *-- "many" Client : manages
    ClusterManager "1" *-- "many" InformerManager : registers
    InformerManager ..> Hub : emits state deltas
    PodLogStreamer ..> Hub : pipes log lines
    ChaosManager ..> ClusterManager : targets clusters
```

---

## 3. UML Sequence Diagrams

### 3.1 Live Pod Anomaly Detection & Incident Resolution Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Workspace Admin
    participant K8s as Kubernetes API (Worker Node)
    participant Inf as client-go InformerFactory
    participant Hub as Go Streamer WebSocket Hub
    participant API as api-server (Express Engine)
    participant DB as PostgreSQL 16
    participant Web as Web Client (useK8sStream)
    participant Canvas as React Flow UI Canvas

    K8s->>Inf: Pod Event: OOMKilled (ExitCode: 137)
    Inf->>Hub: OnUpdate() -> Emit EVENT_POD_STATUS_CHANGED
    
    par Stream to Connected Browser
        Hub->>Web: WS Payload { phase: "CrashLoopBackOff", restartCount: 4 }
        Web->>Canvas: Red Badge Transition & Shake Animation
    and Trigger Backend Incident Pipeline
        Hub->>API: POST /api/v1/incidents/internal/trigger
        API->>DB: INSERT INTO incidents (status: "open", severity: "critical")
        API->>DB: UPDATE clusters SET health_score = health_score - 15.0
        API-->>Hub: Broadcast EVENT_ALERT_TRIGGERED
        Hub->>Web: Alert Toast & Sound Notification
    end

    Admin->>Web: Click "Acknowledge Incident" in Drawer
    Web->>API: PATCH /api/v1/incidents/:id/ack (Bearer JWT)
    API->>DB: UPDATE incidents SET status = "acknowledged", acknowledged_by = userId
    API-->>Web: 200 OK (Status Updated)

    Admin->>Web: Resolve & Provide Root Cause
    Web->>API: PATCH /api/v1/incidents/:id/resolve
    API->>DB: UPDATE incidents SET status = "resolved", root_cause = "Memory leak fixed"
    API-->>Web: 200 OK (Incident Cleared)
```

### 3.2 Real-Time Pod Log Streaming Multiplexing

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Platform Engineer
    participant UI as Terminal Drawer (apps/web)
    participant WS as WebSocket Client
    participant Hub as Go Streamer Hub (:8080)
    participant Streamer as PodLogStreamer Engine
    participant Kubelet as K8s Kubelet API (/logs)

    Operator->>UI: Select Pod -> Click "View Logs"
    UI->>WS: Send WS Message: { action: "TAIL_LOGS", pod: "auth-svc-9b", ns: "default" }
    WS->>Hub: Forward WebSocket Frame
    Hub->>Streamer: StreamLogs(clusterId, "auth-svc-9b", "default")
    Streamer->>Kubelet: GET /api/v1/namespaces/default/pods/auth-svc-9b/log?follow=true
    
    loop Real-Time Log Pipeline
        Kubelet-->>Streamer: stdout/stderr Chunk [200 OK]
        Streamer->>Hub: Encode EVENT_LOG_LINE { line: "INFO: Connection accepted" }
        Hub-->>WS: WS Frame (< 50ms latency)
        WS-->>UI: Append to Virtualized ANSI Terminal
    end

    Operator->>UI: Close Drawer / Switch Pod
    UI->>WS: Send WS Message: { action: "STOP_LOGS" }
    Streamer->>Kubelet: Cancel Request Context (Close HTTP Stream)
```

---

## 4. UML State Machine Diagrams

### 4.1 Kubernetes Pod Workload Lifecycle State Transitions

```mermaid
stateDiagram-v2
    [*] --> Pending : Pod Scheduled
    Pending --> ContainerCreating : Image Pull in Progress
    ContainerCreating --> Running : Containers Initialized & Ready
    
    Running --> HighMemoryUsage : Memory > 85%
    HighMemoryUsage --> Running : Garbage Collected
    HighMemoryUsage --> OOMKilled : Exceeds Memory Limit (Exit 137)
    
    Running --> ErrorCrash : Unhandled Exception (Exit 1)
    ErrorCrash --> CrashLoopBackOff : Backoff Restart Delay
    OOMKilled --> CrashLoopBackOff : Backoff Restart Delay
    CrashLoopBackOff --> Running : Auto-Restart Succeeds
    
    Running --> Terminating : SIGTERM Dispatched
    Terminating --> Succeeded : Job / Completed (Exit 0)
    Terminating --> Failed : Evicted / Force Killed
    
    Succeeded --> [*]
    Failed --> [*]
```

### 4.2 Resilient Cluster Connectivity Statechart

```mermaid
stateDiagram-v2
    [*] --> Disconnected : Added to Workspace
    
    Disconnected --> Hydrating : Server Boot / Sync Requested
    Hydrating --> HandshakePending : AES-256 Decryption OK
    
    HandshakePending --> Connected_Healthy : Version Handshake OK (200 OK)
    HandshakePending --> Offline : Streamer / Cluster Unreachable (400 / 500)
    
    Connected_Healthy --> Connected_Degraded : Pod Crash / Node Pressure
    Connected_Degraded --> Connected_Healthy : Workloads Restored
    Connected_Degraded --> Offline : Connection Lost
    
    Offline --> Reconciling : Reconcile Worker Tick (20s)
    Reconciling --> Connected_Healthy : Cluster Recovered
    Reconciling --> CircuitBreakerTripped : Max Retries Exceeded in Frontend
    
    CircuitBreakerTripped --> Reconciling : Manual Retry / Health Probe OK
```

---

## 5. Algorithmic Flowcharts

### 5.1 Dynamic Cluster Health Index (CHI) Calculation Engine

The Cluster Health Index ($CHI \in [0, 100]$) assesses cluster stability dynamically.

$$\text{CHI} = 100 - \sum \text{PodPenalties} - \sum \text{NodePenalties} - \sum \text{AlertPenalties}$$

```mermaid
flowchart TD
    START(["Start CHI Calculation Cycle"]) --> FETCH["Fetch Cluster Workloads & Metrics<br/>(Pods, Nodes, Active Incidents)"]
    FETCH --> INIT_SCORE["Initialize Base Score: 100.0"]
    
    INIT_SCORE --> POD_LOOP["Iterate All Pods"]
    POD_LOOP --> CHECK_POD{"Pod Phase / Status?"}
    
    CHECK_POD -- "CrashLoopBackOff" --> PEN_CRASH["Deduct: -10 pts per pod<br/>+ (-2 pts * restartCount)"]
    CHECK_POD -- "OOMKilled" --> PEN_OOM["Deduct: -15 pts per pod"]
    CHECK_POD -- "Pending (> 5m)" --> PEN_PEND["Deduct: -5 pts per pod"]
    CHECK_POD -- "Healthy / Running" --> POD_NEXT["No penalty"]
    
    PEN_CRASH --> POD_ACC["Accumulate Pod Penalties"]
    PEN_OOM --> POD_ACC
    PEN_PEND --> POD_ACC
    POD_NEXT --> POD_ACC
    
    POD_ACC --> NODE_CHECK{"Any Node NotReady<br/>or MemoryPressure?"}
    NODE_CHECK -- Yes --> PEN_NODE["Deduct: -25 pts per unhealthy node"]
    NODE_CHECK -- No --> ALERT_CHECK
    PEN_NODE --> ALERT_CHECK
    
    ALERT_CHECK{"Active Unresolved Incidents?"}
    ALERT_CHECK -- "Critical" --> PEN_CRIT["Deduct: -10 pts per incident"]
    ALERT_CHECK -- "Warning" --> PEN_WARN["Deduct: -3 pts per incident"]
    ALERT_CHECK -- "None" --> CLAMP
    PEN_CRIT --> CLAMP
    PEN_WARN --> CLAMP
    
    CLAMP["Clamp Score: Max(0.0, Min(100.0, Score))"]
    CLAMP --> RATING{"Assign Status Rating"}
    
    RATING -- "CHI >= 85" --> STATUS_H["status = 'HEALTHY'"]
    RATING -- "60 <= CHI < 85" --> STATUS_D["status = 'DEGRADED'"]
    RATING -- "CHI < 60" --> STATUS_C["status = 'CRITICAL'"]
    
    STATUS_H --> SAVE["INSERT INTO health_snapshots<br/>UPDATE clusters SET health_score"]
    STATUS_D --> SAVE
    STATUS_C --> SAVE
    SAVE --> END(["Cycle Complete"])
```

### 5.2 Chaos Fault Injection & Reversible Resolution Pipeline

```mermaid
flowchart TD
    TRIGGER(["Operator Triggers Fault in UI<br/>(Crash, Latency, OOM, Scale Down)"]) --> AUTH_VERIFY{"Verify Workspace Role<br/>(ADMIN / OPERATOR permission)"}
    
    AUTH_VERIFY -- Denied --> ERR_403["Return HTTP 403 Forbidden<br/>Toast: Insufficient Privileges"]
    AUTH_VERIFY -- Allowed --> DISPATCH["Forward Request to Go Streamer<br/>POST /api/v1/chaos/inject"]
    
    DISPATCH --> TARGET_RESOLVE{"Target Resource Available<br/>in Informer Cache?"}
    TARGET_RESOLVE -- No --> ERR_404["Return HTTP 404 Resource Not Found"]
    
    TARGET_RESOLVE -- Yes --> FAULT_TYPE{"Select Fault Engine"}
    
    FAULT_TYPE -- "Simulate Crash (FaultCrash)" --> K8S_KILL["client-go CoreV1.Pods().Delete()<br/>GracePeriodSeconds: 0 (SIGKILL)<br/>Set 15s Ephemeral Latch in Memory"]
    FAULT_TYPE -- "Memory Stress (FaultOOMPressure)" --> STRESS_OOM["Clamp requests.memory <= 1Mi<br/>Patch limits.memory = 4Mi<br/>Trigger Linux Kernel Cgroup OOM Killer"]
    FAULT_TYPE -- "Scale Down (FaultScaleDown)" --> RESOLVE_DEP["resolveDeployment(): Climb OwnerReferences<br/>Pod -> ReplicaSet -> Deployment<br/>Save originalReplicas in Memory<br/>Patch appsV1.Deployments().Scale(0)"]
    
    K8S_KILL --> REG_FAULT["Record in activeFaults Registry<br/>(Thread-Safe sync.RWMutex)"]
    STRESS_OOM --> REG_FAULT
    RESOLVE_DEP --> REG_FAULT
    
    REG_FAULT --> BROADCAST["Hub Broadcasts EVENT_CHAOS_FAULT_INJECTED<br/>to WebSocket Room (Sub-200ms)"]
    
    BROADCAST --> UI_REACTIVE["Frontend useTopologyStore Ingests Delta<br/>- Workload Card Crimson Ring & Badge<br/>- Pod Honeycomb Flashing Ping<br/>- Chaos Tab Real-Time Monitor Entry"]
    
    UI_REACTIVE --> REVERT_TRIGGER(["Operator Clicks [Revert Fault]<br/>or Ephemeral Latch Expires"])
    
    REVERT_TRIGGER --> REVERT_REQ["DELETE /api/v1/chaos/inject?faultId=..."]
    REVERT_REQ --> CLEAR_FAULT{"ClearFault(faultID)"}
    
    CLEAR_FAULT -- "Scale Down" --> RESTORE_SCALE["Patch Deployment replicas = originalReplicas"]
    CLEAR_FAULT -- "OOM Pressure" --> RESTORE_OOM["Restore Container Spec Limits"]
    CLEAR_FAULT -- "Crash Latch" --> CLEAR_LATCH["Evict Latch Entry from Active Registry"]
    
    RESTORE_SCALE --> BROADCAST_CLEAR["Hub Broadcasts EVENT_CHAOS_FAULT_CLEARED"]
    RESTORE_OOM --> BROADCAST_CLEAR
    CLEAR_LATCH --> BROADCAST_CLEAR
    
    BROADCAST_CLEAR --> UI_HEAL["Frontend Removes Chaos Warning<br/>Restores Green Status & Normal Aura"]
```

---

## 6. Codebase Traceability Matrix

| Architectural Construct | Source Implementation Link | Domain Owner |
| :--- | :--- | :--- |
| **Relational Schemas** | [`apps/api-server/src/db/schema/`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/api-server/src/db/schema) | **Vinit** |
| **Crypto AES-256 Vault** | [`crypto.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/api-server/src/utils/crypto.ts) | **Vinit** |
| **Health Calculation** | [`health-calculator.service.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/api-server/src/services/health-calculator.service.ts) | **Vinit** |
| **Cluster Reconciler** | [`cluster-reconcile.worker.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/api-server/src/workers/cluster-reconcile.worker.ts) | **Vinit** |
| **WebSocket Streaming Hub** | [`hub.go`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/k8s-streamer/pkg/websocket/hub.go) | **Pranav** |
| **Informer Manager** | [`cluster_manager.go`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/k8s-streamer/pkg/k8s/cluster_manager.go) | **Pranav** |
| **Config & Secret Informers** | [`config_informer.go`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/k8s-streamer/pkg/k8s/config_informer.go) | **Pranav** |
| **Chaos Testing Engine** | [`injector.go`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/k8s-streamer/pkg/chaos/injector.go) | **Pranav** |
| **Streaming UI Hook** | [`useK8sStream.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/hooks/useK8sStream.ts) | **Neha** |
| **Topology Graph Store** | [`useTopologyStore.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/store/useTopologyStore.ts) | **Neha** |
| **Chaos Store Slice & Helpers** | [`topologyWsSlice.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/store/slices/topologyWsSlice.ts), [`chaosHelpers.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/store/helpers/chaosHelpers.ts) | **Neha** |
| **Dynamic Edge Routing** | [`K8sEdge.tsx`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/components/canvas/K8sEdge.tsx), [`layout.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/utils/layout.ts) | **Neha** |
| **Micro-Honeycomb & Nodes** | [`K8sGroup.tsx`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/components/canvas/K8sGroup.tsx), [`K8sPod.tsx`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/components/canvas/K8sPod.tsx) | **Neha** |
| **UI Primitives & Modals** | [`components/ui/`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/components/ui) | **Ishika** |
| **Config & Drawer Overview** | [`ConfigOverviewSection.tsx`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/components/drawer/inspector/ConfigOverviewSection.tsx) | **Ishika** |

---

## 7. Granular Technical Mechanics: Elementary-to-Minute Architecture

This section documents the foundational operating principles, minute implementation mechanics, and boundary failure prevention strategies for recent subsystems across the repository.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     ENVSCALE REAL-TIME ARCHITECTURE                              │
├──────────────────────────────┬──────────────────────────────────┬────────────────────────────────┤
│ 1. Chaos Engine              │ 2. Dynamic Visual Topology       │ 3. Zero-Leak Config Informers  │
│ - OwnerReference Climbing    │ - 4-Cardinal Handle Routing      │ - Key Metadata Extraction Only │
│ - Cgroup OOM Request Clamp   │ - Vertical Drop PVC Clearance    │ - No Secrets over the Wire     │
│ - 15s Ephemeral Latch        │ - Micro-Honeycomb Pulsing Ping   │ - Pod Spec Mount Correlation   │
│ - Bidirectional Reversibility│ - Dynamic Dagre Layout Slicing   │ - Drawer Inspector Integration │
└──────────────────────────────┴──────────────────────────────────┴────────────────────────────────┘
```

### 7.1 Chaos Fault Engine Mechanics (`apps/k8s-streamer/pkg/chaos/injector.go`)

The chaos engine allows platform engineers to inject synthetic disruptions into target Kubernetes clusters to validate alerting, self-healing, and visual observability pipelines.

#### 7.1.1 Target Hierarchy Resolution (`resolveDeployment`)
* **The Problem:** In Kubernetes, users view Workloads (Deployments) or individual Pods. If an operator triggers a `FaultScaleDown` on an individual pod (e.g., `backend-6b87645cf4-xk92m`), calling the Kubernetes Deployment API directly with the pod name fails with `404 Not Found`, because the Deployment name is simply `backend`.
* **The Minute Mechanic:** The engine implements recursive hierarchical resolution via `pod.OwnerReferences`:
  1. Inspects the target pod's `OwnerReferences`. Identifies the parent `ReplicaSet` (e.g., `backend-6b87645cf4`, Kind: `ReplicaSet`).
  2. Executes `clientset.AppsV1().ReplicaSets(namespace).Get(ctx, rsName, metav1.GetOptions{})`.
  3. Inspects the ReplicaSet's `OwnerReferences`. Identifies the root `Deployment` (e.g., `backend`, Kind: `Deployment`).
  4. Returns the resolved Deployment name and its namespace. If the input name is already a Deployment, it validates its existence directly.

#### 7.1.2 Scale-Down Fault & Reversibility (`FaultScaleDown`)
* **Mechanism:** 
  1. Reads `deployment.Spec.Replicas` and caches `originalReplicas: int32` in the active fault record.
  2. Patches the target deployment using `clientset.AppsV1().Deployments(ns).UpdateScale(...)` setting `replicas = 0`.
  3. Generates a unique fault identifier `chaos-<uuid>`.
  4. Broadcasts `EVENT_CHAOS_FAULT_INJECTED` containing `{ faultId, faultType: "scale_down", targetName, targetNamespace, originalReplicas }`.
* **Reversal (`ClearFault`):**
  When the operator clicks `[Revert Fault]` or sends `DELETE /api/v1/chaos/inject?faultId=...`, the engine retrieves the cached record, patches `replicas = originalReplicas`, evicts the record from the in-memory map, and broadcasts `EVENT_CHAOS_FAULT_CLEARED`.

#### 7.1.3 Cgroup Memory Pressure & Admission Clamping (`FaultOOMPressure`)
* **Elementary Concept:** In Linux containers, memory consumption is capped via cgroups. When container memory exceeds `resources.limits.memory`, the Linux kernel triggers the Out-Of-Memory (OOM) killer, terminating the container process with exit status `137` (`SIGKILL = 128 + 9`).
* **The Admission Rejection Trap:** Kubernetes API validation enforces `requests.memory <= limits.memory`. If a container originally defined `requests: { memory: "64Mi" }` and the chaos injector attempts to patch `limits: { memory: "4Mi" }`, the Kubernetes admission controller rejects the request with HTTP 422 (`Invalid value: 4Mi: must be greater than or equal to request 64Mi`).
* **The Minute Solution (`recreatePodWithMemoryLimit`):**
  1. Clamps `requests.memory` to `1Mi` (or $\le 1\text{Mi}$) alongside `limits.memory = "4Mi"`.
  2. Because Kubernetes Pod specs do not permit in-place mutation of container resource limits on running pods in standard clusters, the injector reads the existing Pod definition, strips cluster-assigned metadata (`UID`, `ResourceVersion`), injects the clamped resource constraints, force-deletes the old pod, and creates the replacement pod.
* **Status Preservation in Informer Handlers (`informer_handlers.go`):**
  When a container is killed by OOM, kubelet quickly places the container into a restart backoff wait (`Waiting.Reason = "CrashLoopBackOff"`). To prevent the UI from masking the real failure cause, the informer handler checks:
  ```go
  if cs.LastTerminationState.Terminated != nil && cs.LastTerminationState.Terminated.Reason == "OOMKilled" {
      phase = "OOMKilled"
  }
  ```
  This guarantees that OOM events remain explicitly visible on the visual canvas.

#### 7.1.4 Ephemeral Crash Latch Window (`FaultCrash`)
* **The Self-Healing Dilemma:** When `clientset.CoreV1().Pods(ns).Delete(ctx, podName, metav1.DeleteOptions{GracePeriodSeconds: &zero})` is executed, the Kubernetes ReplicaSet controller reconciles the desired replica count and boots a replacement pod in under $300\text{ms}$. If the streaming gateway only forwarded raw pod lifecycles, the crash would vanish before a human operator or the frontend could perceive the failure.
* **The Minute Solution:**
  1. The injector force-deletes the pod.
  2. It installs an **ephemeral latch** in the active fault registry with an expiration deadline of $T_{\text{latch}} = 15\text{ seconds}$.
  3. A background Go goroutine arms a timer:
     ```go
     time.AfterFunc(15*time.Second, func() {
         injector.ClearFault(faultID)
     })
     ```
  4. The frontend canvas highlights the workload in a pulsing crimson warning state throughout the entire latch window, ensuring human visibility even during lightning-fast sub-second controller recovery.

#### 7.1.5 Cross-Origin Resource Sharing (CORS) Preflight Protocol
* **Elementary Concept:** Modern browsers enforce the Same-Origin Policy. When the frontend on `http://localhost:5173` sends a `DELETE` request with custom headers to the Go gateway on `http://localhost:8080`, the browser dispatches an HTTP `OPTIONS` preflight request.
* **The Failure Mode:** If the server returns a wildcard `Access-Control-Allow-Origin: *` while the client specifies `credentials: "include"`, or omits `DELETE` from `Access-Control-Allow-Methods`, the browser rejects the network call with a silent `"Failed to fetch"`.
* **The Resolution:**
  - In `cmd/server/main.go`, `corsHandler` dynamically reflects the client's `Origin` header (`w.Header().Set("Access-Control-Allow-Origin", origin)`), specifies `Access-Control-Allow-Credentials: true`, and permits methods `GET, POST, PUT, DELETE, OPTIONS`.
  - In `InspectorDrawer.tsx` and `ChaosTab.tsx`, requests target `STREAMER_BASE_URL` directly without conflicting credentials configurations.

---

### 7.2 Frontend Reactive State Management & Visual Cues (`apps/web`)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 REACT FLOW WORKLOAD CARD                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  ⚡ CHAOS: SCALE_DOWN (ACTIVE)                  [0/0 Replicas]                         │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Pod Glyphs Heatmap:                                                              │  │
│  │   [●] healthy (emerald)       [⚡] chaos target (rose-600 animate-ping)          │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│  Crimson Glow: border-rose-500 shadow-rose-950/40 ring-1 ring-rose-500/30              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 7.2.1 Zustand Store Architecture (`useTopologyStore.ts`, `topologyWsSlice.ts`)
* **State Declaration:**
  `activeChaosFaults: Record<string, ChaosFaultRecord>` maintains a synchronized client-side dictionary of all live disruptions.
* **Delta Reducers (`chaosHelpers.ts`):**
  - `addChaosFault`: Pure function that merges an incoming `EVENT_CHAOS_FAULT_INJECTED` payload into `activeChaosFaults` without mutating existing state.
  - `removeChaosFault`: Pure function that creates a shallow clone, deletes the specified `faultId`, and returns the pruned dictionary.

#### 7.2.2 Micro-Honeycomb Heatmap Glyphs (`K8sGroup.tsx`, `K8sPod.tsx`)
* **Glyph State Machine:**
  Each pod glyph inside a workload container reflects its operational state through a 3-tier visual hierarchy:
  1. **Healthy:** `bg-emerald-500/80 hover:bg-emerald-400`
  2. **Active Chaos Injection:** `bg-rose-600 animate-ping ring-2 ring-rose-400` with an outer glowing crimson aura (`shadow-rose-950/40`).
  3. **Organic Error / CrashLoop:** `bg-rose-500` (static) or `bg-amber-500` (pending/terminating).
* **Workload Card Dynamics:**
  When a child pod or the parent deployment matches an entry in `activeChaosFaults`:
  - The card header renders a prominent badge: `⚡ CHAOS: [FAULT_TYPE]`.
  - If replicas are scaled to zero, the card renders a dedicated notice: `[0/0 REPLICAS] - SCALED DOWN BY CHAOS INJECTOR`.
  - The card container transitions its borders to `border-rose-500` with an animated pulse.

#### 7.2.3 One-Click Fault Healing (`ChaosTab.tsx`)
* The Inspector Drawer renders an "Active Faults (Real-Time)" monitor.
* For every active fault in the store, it displays:
  - Fault ID and target resource identifier.
  - Formatted elapsed duration since injection.
  - A `[Revert Fault]` button that dispatches `DELETE /api/v1/chaos/inject?faultId=...`, which triggers instantaneous cluster reconciliation and clears the visual warning upon receiving `EVENT_CHAOS_FAULT_CLEARED`.

---

### 7.3 Dynamic Canvas Edge Routing & Cardinal Handles (`layout.ts`, `K8sEdge.tsx`)

#### 7.3.1 4-Cardinal Handle Geometry
* **The Visual Challenge:** Standard graph edges between Services, Workloads, and Storage Volumes frequently produced crossing lines and 300px S-curves because nodes only possessed single left/right connection anchors.
* **The Cardinal System:**
  Every node primitive (`K8sGroup`, `K8sPod`, `K8sService`, `K8sPVC`, `K8sIngress`, `K8sWorkload`) now exposes 8 discrete handle anchors:
  - **Targets:** `target-left`, `target-right`, `target-top`, `target-bottom`.
  - **Sources:** `source-left`, `source-right`, `source-top`, `source-bottom`.

#### 7.3.2 Storage Vertical Drop Heuristic
* **The Route:** Workloads connecting to Persistent Volume Claims (PVCs) route strictly from `source-bottom` to `target-top`.
* **The Layout Sort (`layout.ts`):**
  To prevent storage nodes from rendering directly beneath intermediate compute nodes and causing vertical edge crossings:
  1. Workloads are partitioned into pure-compute and storage-backed workloads.
  2. Storage-backed workloads and their attached PVCs are shifted to the right flank of the layout.
  3. Sibling horizontal clearance is set to $\ge 100\text{px}$, allowing vertical drop lines to descend cleanly without intersecting adjacent workload bounding boxes.

#### 7.3.3 Dynamic Cubic Bezier Smoothing (`K8sEdge.tsx`)
* The custom edge component calculates dynamic curvature $\kappa$:
  $$\kappa = \min\left(0.5, \frac{|\Delta X| + |\Delta Y|}{800}\right)$$
* Calculates the geometric apex $(X_{\text{mid}}, Y_{\text{mid}})$ to position traffic badges and protocol tags (`TCP`, `HTTP`, `gRPC`) directly on the edge curve without clipping node boundaries.

---

### 7.4 Zero-Leak Configuration & Secret Topology (`pkg/k8s/config_informer.go`)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                       ZERO-LEAK KUBERNETES CONFIGURATION INFORMER                      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  K8s API Server (Secrets / ConfigMaps)                                                 │
│       │                                                                                │
│       ▼ client-go Informer                                                             │
│  [config_informer.go]                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Sanitization Engine:                                                             │  │
│  │   - Extracts: Name, Namespace, CreationTimestamp, SecretType                     │  │
│  │   - Extracts: []Keys (e.g. ["DATABASE_URL", "JWT_SECRET"])                       │  │
│  │   - PURGES: All Data values, base64 payloads, and binary blocks                  │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│       │                                                                                │
│       ▼ WebSocket Event: EVENT_CONFIG_TOPOLOGY_UPDATED (Metadata Only)                 │
│  Web UI (Inspector Drawer - ConfigOverviewSection)                                    │
│  - Displays mounted keys, secret classifications, and volume attachments               │
│  - ZERO sensitive credentials stored or transmitted over the wire                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 7.4.1 Zero-Leak Security Architecture
* **The Principle of Least Privilege:** Operators require architectural visibility into which configuration sources and credentials are bound to specific microservices, but observability tools must NEVER expose raw passwords, private keys, or API tokens.
* **Sanitization in Go (`config_informer.go`):**
  When `ConfigMapInformer` or `SecretInformer` triggers an event (`OnAdd`, `OnUpdate`), the handler constructs a sanitized descriptor:
  ```go
  type SanitizedConfigResource struct {
      Name              string    `json:"name"`
      Namespace         string    `json:"namespace"`
      Type              string    `json:"type"`              // e.g., "Opaque", "kubernetes.io/tls"
      Keys              []string  `json:"keys"`              // Extracted key names ONLY
      CreationTimestamp time.Time `json:"creationTimestamp"`
      ResourceVersion   string    `json:"resourceVersion"`
  }
  ```
  `Data` and `StringData` maps are completely omitted from the serialization schema. Only the alphabetical key names are transmitted.

#### 7.4.2 Workload-to-Configuration Correlation
* The engine parses Pod container specifications:
  1. **Volume Mounts:** Inspects `pod.Spec.Volumes[*].ConfigMap.Name` and `pod.Spec.Volumes[*].Secret.SecretName`.
  2. **Environment Variable References:** Inspects `container.Env[*].ValueFrom.ConfigMapKeyRef` and `container.Env[*].ValueFrom.SecretKeyRef`.
  3. **Whole-Object Environment Injections:** Inspects `container.EnvFrom[*].ConfigMapRef` and `container.EnvFrom[*].SecretRef`.
* Correlates these references against sanitized Informer caches to assemble an aggregated configuration dependency graph.

#### 7.4.3 Inspector Drawer Visualization (`ConfigOverviewSection.tsx`)
* The Overview tab in the Inspector Drawer renders a dedicated configuration breakdown:
  - **ConfigMaps Panel:** Lists attached configuration volumes and environment keys with descriptive tags.
  - **Secrets Panel:** Identifies bound secrets, their Kubernetes type (`Opaque`, `kubernetes.io/tls`, `kubernetes.io/service-account-token`), and exposed key identifiers.
  - Guarantees zero credential leakage while delivering complete architectural visibility for debugging configuration drift and missing environment variables.

