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

### 5.2 Chaos Fault Injection Pipeline

```mermaid
flowchart TD
    TRIGGER(["Operator Triggers Fault in UI<br/>(Crash, Latency, OOM)"]) --> AUTH_VERIFY{"Verify Workspace Role<br/>(ADMIN permission required)"}
    
    AUTH_VERIFY -- Denied --> ERR_403["Return HTTP 403 Forbidden<br/>Toast: Insufficient Privileges"]
    AUTH_VERIFY -- Allowed --> DISPATCH["Forward Request to Go Streamer<br/>POST /api/v1/chaos/inject"]
    
    DISPATCH --> TARGET_RESOLVE{"Target Pod Available<br/>in Informer Cache?"}
    TARGET_RESOLVE -- No --> ERR_404["Return HTTP 404 Pod Not Found"]
    
    TARGET_RESOLVE -- Yes --> FAULT_TYPE{"Select Fault Engine"}
    
    FAULT_TYPE -- "Simulate Crash" --> K8S_KILL["client-go CoreV1.Pods().Delete()<br/>with GracePeriodSeconds: 0"]
    FAULT_TYPE -- "Network Latency" --> TC_EXEC["Inject Traffic Control delay<br/>tc qdisc add netem delay 250ms"]
    FAULT_TYPE -- "Memory Stress" --> STRESS_OOM["Spawn memory allocation stressor<br/>triggering kernel OOM Killer"]
    
    K8S_KILL --> BROADCAST["Hub Emits EVENT_POD_STATUS_CHANGED"]
    TC_EXEC --> BROADCAST
    STRESS_OOM --> BROADCAST
    
    BROADCAST --> LOG_AUDIT["Record Event in Audit Log<br/>and Increment Workspace Chaos Stat"]
    LOG_AUDIT --> FIN(["Fault Injection Active"])
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
| **Chaos Testing Engine** | [`chaos`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/k8s-streamer/pkg/chaos) | **Pranav** |
| **Streaming UI Hook** | [`useK8sStream.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/hooks/useK8sStream.ts) | **Neha** |
| **Topology Graph Store** | [`useTopologyStore.ts`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/store/useTopologyStore.ts) | **Neha** |
| **UI Primitives & Modals** | [`components/ui/`](file:///run/media/pranavissam/files%20and%20data/programming/mega%20projects/EnvScale/apps/web/src/components/ui) | **Ishika** |
