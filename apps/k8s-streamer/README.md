# EnvScale — `k8s-streamer` Service

> **Owner:** Pranav (Architecture & Core System Engine)

`k8s-streamer` is the high-performance Go WebSocket gateway and Kubernetes Informer event stream processor for EnvScale. It connects directly to target Kubernetes API control planes via `client-go` `SharedInformerFactory` and broadcasts state changes (`Pod`, `Node`, `Service`) to UI subscribers over WebSockets.

---

## Technical Features

- **Gorilla WebSocket Gateway:** Concurrent WebSocket Hub (`pkg/websocket`) for real-time sub-200ms delta broadcasting.
- **client-go Informers:** Native Kubernetes Informer factory (`pkg/k8s`) listening for pod status changes, node ready state, and service routing updates.
- **AES-256-GCM Vault Module:** Decrypts encrypted Kubeconfig secrets stored in PostgreSQL (`pkg/crypto`).
- **Standardized Event Frames:** Broadcasts `WSEventEnvelope` containing `EVENT_POD_STATUS_CHANGED`, `EVENT_NODE_MUTATED`, `EVENT_SERVICE_MUTATED`, and `EVENT_HEARTBEAT`.

---

## Local Development & Execution

```bash
# Navigate to streamer service
cd apps/k8s-streamer

# Download dependencies
go mod tidy

# Run server locally
go run ./cmd/server/main.go
```

The service will start listening on port `:8080`:
- **Health Check:** `http://localhost:8080/healthz`
- **WebSocket Stream:** `ws://localhost:8080/ws/k8s`
