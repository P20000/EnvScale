package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	envredis "github.com/EnvScale/k8s-streamer/pkg/redis"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

type registerClusterRequest struct {
	ClusterID       string `json:"clusterId"`
	Kubeconfig      string `json:"kubeconfig"`      // Base64 or raw YAML
	IsInClusterMode bool   `json:"isInClusterMode"` // Optional flag for in-cluster ServiceAccount mode
}

type logStreamRequest struct {
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	PodName   string `json:"podName"`
	Container string `json:"container"` // optional — defaults to first container
	TailLines int64  `json:"tailLines"` // number of historical lines to tail before following
}

type chaosInjectRequest struct {
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`      // Pod name (crash, oom-pressure) or Deployment name (scale-down)
	FaultType string `json:"faultType"` // "crash" | "oom-pressure" | "scale-down"
}

type chaosClearRequest struct {
	FaultID string `json:"faultId"`
}

func main() {
	log.Println("==================================================")
	log.Println(" Starting EnvScale K8s WebSocket Streaming Gateway")
	log.Println("==================================================")

	// Load .env file if present
	if err := godotenv.Load(); err != nil {
		log.Println("[Config] No .env file found; using default environment variables")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Initialize WebSocket Hub
	hub := websocket.NewHub()
	go hub.Run()
	log.Println("[WebSocket Hub] Streaming event hub initialized and running")

	// Initialize ClusterManager registry
	clusterManager := k8s.NewClusterManager(hub)
	log.Println("[ClusterManager] Dynamic multi-tenant cluster registry initialized")

	// Auto-register local Kubeconfig cluster 'mini-todo' if ~/.kube/config is available
	kubeconfigPath := os.Getenv("KUBECONFIG")
	if kubeconfigPath == "" {
		if home, err := os.UserHomeDir(); err == nil {
			kubeconfigPath = fmt.Sprintf("%s/.kube/config", home)
		}
	}
	if kubeconfigPath != "" {
		if rawKube, err := os.ReadFile(kubeconfigPath); err == nil && len(rawKube) > 0 {
			if err := clusterManager.RegisterCluster("mini-todo", rawKube); err == nil {
				log.Println("[ClusterManager] Auto-registered local Kubernetes cluster 'mini-todo'")
			} else {
				log.Printf("[ClusterManager] Warning auto-registering 'mini-todo': %v", err)
			}
		}
	}

	// Initialize PodLogStreamer — shared log tailing engine backed by the same Hub
	logStreamer := k8s.NewPodLogStreamer(hub)
	log.Println("[LogStreamer] Pod log streaming engine initialized")

	// ── Optional Redis Pub/Sub Adapter ──────────────────────────────────────────
	// When REDIS_URL is set, the Hub will fan-out every BroadcastEvent to all
	// peer k8s-streamer instances sharing the same Redis instance, enabling
	// horizontal scaling without losing cross-replica event delivery.
	// If Redis is unavailable or REDIS_URL is not set, the streamer falls back
	// to single-instance mode gracefully — no crash, just a log warning.
	var redisAdapter *envredis.Adapter
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		adapter, err := envredis.NewAdapter(envredis.Config{URL: redisURL}, hub)
		if err != nil {
			log.Printf("[Redis Adapter] WARNING: Could not connect to Redis (%v) — running in single-instance mode", err)
		} else {
			adapter.Start(context.Background())
			hub.SetPublisher(adapter)
			redisAdapter = adapter
			log.Printf("[Redis Adapter] Pub/Sub adapter active — multi-instance event fan-out enabled")
		}
	} else {
		log.Println("[Redis Adapter] REDIS_URL not set — running in single-instance mode (no fan-out)")
	}

	// ── Chaos Fault Injection Engine ────────────────────────────────────────────
	// ── Chaos Fault Injection Engine ────────────────────────────────────────────
	// The chaos injector uses real Kubernetes API calls to inject controlled
	// failure scenarios (pod crashes, OOM pressure, scale-downs) for testing.
	chaosInjector := chaos.NewInjector(clusterManager, hub)
	log.Println("[Chaos Engine] Fault injection engine initialized")

	// ── Metric Evaluator Background Worker ──────────────────────────────────────
	// Evaluates live pod snapshots against alert rules every 10s and emits EVENT_ALERT_TRIGGERED
	metricEvaluator := k8s.NewMetricEvaluator(clusterManager, hub)
	metricEvaluator.Start()

	mux := http.NewServeMux()

	// Health Check Endpoint
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		redisStatus := "disabled"
		if redisAdapter != nil && redisAdapter.IsRunning() {
			redisStatus = "connected"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":           "ok",
			"service":          "k8s-streamer",
			"activeClients":    hub.ClientCount(),
			"activeClusters":   clusterManager.ActiveClusterCount(),
			"activeLogStreams":  logStreamer.ActiveStreamCount(),
			"activeChaosOps":   chaosInjector.ActiveFaultCount(),
			"activeAlertRules": metricEvaluator.RuleCount(),
			"redisStatus":      redisStatus,
			"timestamp":        time.Now().UTC().Format(time.RFC3339),
		})
	})

	// WebSocket Gateway Endpoint
	mux.HandleFunc("/ws/k8s", func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("clientId")
		if clientID == "" {
			clientID = fmt.Sprintf("client-%d", time.Now().UnixNano())
		}
		websocket.ServeWs(hub, clientID, w, r)
	})

	// Register Cluster Endpoint (REST API called by api-server or onboarding flow)
	mux.HandleFunc("/api/v1/clusters/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		var req registerClusterRequest
		if err := json.Unmarshal(body, &req); err != nil || req.ClusterID == "" {
			http.Error(w, "Invalid payload: clusterId is required", http.StatusBadRequest)
			return
		}

		if req.IsInClusterMode {
			if err := clusterManager.RegisterInCluster(req.ClusterID); err != nil {
				http.Error(w, fmt.Sprintf("Failed to register in-cluster: %v", err), http.StatusInternalServerError)
				return
			}
		} else {
			if req.Kubeconfig == "" {
				http.Error(w, "kubeconfig is required when not in cluster mode", http.StatusBadRequest)
				return
			}

			// Support base64 encoded kubeconfig or raw YAML
			rawKubeconfig := []byte(req.Kubeconfig)
			if decoded, err := base64.StdEncoding.DecodeString(req.Kubeconfig); err == nil && len(decoded) > 0 {
				rawKubeconfig = decoded
			}

			if err := clusterManager.RegisterCluster(req.ClusterID, rawKubeconfig); err != nil {
				http.Error(w, fmt.Sprintf("Failed to register cluster: %v", err), http.StatusBadRequest)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "registered",
			"clusterId": req.ClusterID,
		})
	})

	// Snapshot Endpoint (REST API called by frontend on websocket connection)
	mux.HandleFunc("/api/v1/clusters/snapshot", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		clusterID := r.URL.Query().Get("clusterId")
		if clusterID == "" {
			http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
			return
		}

		pods, nodes, services, deployments, replicaSets, statefulSets, ingresses, err := clusterManager.GetClusterSnapshot(clusterID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"pods":         pods,
			"nodes":        nodes,
			"services":     services,
			"deployments":  deployments,
			"replicaSets":  replicaSets,
			"statefulSets": statefulSets,
			"ingresses":    ingresses,
		})
	})

	// List Active Monitored Clusters
	mux.HandleFunc("/api/v1/clusters", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"clusters": clusterManager.ListClusters(),
				"total":    clusterManager.ActiveClusterCount(),
			})
			return
		}

		// Support DELETE /api/v1/clusters?clusterId=xyz
		if r.Method == http.MethodDelete {
			clusterID := r.URL.Query().Get("clusterId")
			if clusterID == "" {
				http.Error(w, "clusterId query parameter required", http.StatusBadRequest)
				return
			}

			if err := clusterManager.UnregisterCluster(clusterID); err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "unregistered",
				"clusterId": clusterID,
			})
			return
		}

		// Support DELETE /api/v1/clusters/:id style path
		if r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/api/v1/clusters/") {
			parts := strings.Split(r.URL.Path, "/")
			clusterID := parts[len(parts)-1]
			if clusterID != "" {
				if err := clusterManager.UnregisterCluster(clusterID); err != nil {
					http.Error(w, err.Error(), http.StatusNotFound)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status":    "unregistered",
					"clusterId": clusterID,
				})
				return
			}
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	// POST /api/v1/logs/stream  — start tailing logs for a pod/container
	// DELETE /api/v1/logs/stream — stop an active log stream
	mux.HandleFunc("/api/v1/logs/stream", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		var req logStreamRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}
		if req.ClusterID == "" || req.Namespace == "" || req.PodName == "" {
			http.Error(w, "clusterId, namespace, and podName are required", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodPost:
			// Retrieve the InformerManager so we can borrow its kubernetes.Interface clientset
			im, ok := clusterManager.GetCluster(req.ClusterID)
			if !ok {
				http.Error(w, fmt.Sprintf("cluster '%s' is not registered", req.ClusterID), http.StatusNotFound)
				return
			}

			tailLines := req.TailLines
			if tailLines <= 0 {
				tailLines = 100 // sensible default
			}

			if err := logStreamer.StartStream(
				context.Background(),
				im.Clientset(),
				req.ClusterID, req.Namespace, req.PodName, req.Container,
				tailLines,
			); err != nil {
				http.Error(w, fmt.Sprintf("Failed to start log stream: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "streaming",
				"clusterId": req.ClusterID,
				"namespace": req.Namespace,
				"pod":       req.PodName,
				"container": req.Container,
			})

		case http.MethodDelete:
			logStreamer.StopStream(req.ClusterID, req.Namespace, req.PodName, req.Container)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "stopped",
				"clusterId": req.ClusterID,
				"namespace": req.Namespace,
				"pod":       req.PodName,
			})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// ── Chaos Fault Injection Endpoints ──────────────────────────────────────────
	//
	// POST   /api/v1/chaos/inject   — inject a fault (crash | oom-pressure | scale-down)
	// DELETE /api/v1/chaos/inject   — clear/cancel a previously injected fault by faultId
	// GET    /api/v1/chaos/faults   — list all active fault injections for a cluster
	//
	mux.HandleFunc("/api/v1/chaos/inject", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodPost:
			var req chaosInjectRequest
			if err := json.Unmarshal(body, &req); err != nil {
				http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
				return
			}
			if req.ClusterID == "" || req.Namespace == "" || req.Name == "" || req.FaultType == "" {
				http.Error(w, "clusterId, namespace, name, and faultType are required", http.StatusBadRequest)
				return
			}

			faultID, err := chaosInjector.InjectFault(
				r.Context(),
				req.ClusterID,
				req.Namespace,
				req.Name,
				chaos.FaultType(req.FaultType),
			)
			if err != nil {
				http.Error(w, fmt.Sprintf("Fault injection failed: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "injected",
				"faultId":   faultID,
				"faultType": req.FaultType,
				"target":    req.Name,
				"namespace": req.Namespace,
				"clusterId": req.ClusterID,
			})

		case http.MethodDelete:
			var req chaosClearRequest
			if err := json.Unmarshal(body, &req); err != nil || req.FaultID == "" {
				http.Error(w, "faultId is required in request body", http.StatusBadRequest)
				return
			}

			if err := chaosInjector.ClearFault(r.Context(), req.FaultID); err != nil {
				http.Error(w, fmt.Sprintf("Failed to clear fault: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "cleared",
				"faultId": req.FaultID,
			})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// GET /api/v1/chaos/faults — list active fault injections for a cluster
	mux.HandleFunc("/api/v1/chaos/faults", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		clusterID := r.URL.Query().Get("clusterId") // optional filter
		faults := chaosInjector.ListFaults(clusterID)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"activeFaults": faults,
			"total":        len(faults),
		})
	})

	// ── Metric Evaluator Alert Policy Rules REST Endpoint ────────────────────────
	//
	// GET    /api/v1/evaluator/rules — list active evaluation rules
	// POST   /api/v1/evaluator/rules — push a list of rules (sync) or add a single rule
	// DELETE /api/v1/evaluator/rules — delete a rule by ruleId query parameter
	//
	mux.HandleFunc("/api/v1/evaluator/rules", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			rules := metricEvaluator.ListRules()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"rules": rules,
				"total": len(rules),
			})

		case http.MethodPost:
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "Failed to read request body", http.StatusBadRequest)
				return
			}

			// Check if payload is an array of rules or a single rule
			var rules []k8s.AlertRule
			if err := json.Unmarshal(body, &rules); err == nil {
				metricEvaluator.SetRules(rules)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status": "rules_synced",
					"count":  len(rules),
				})
				return
			}

			var singleRule k8s.AlertRule
			if err := json.Unmarshal(body, &singleRule); err == nil && singleRule.RuleID != "" {
				metricEvaluator.AddRule(singleRule)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status": "rule_added",
					"ruleId": singleRule.RuleID,
				})
				return
			}

			http.Error(w, "Invalid JSON payload — expected single AlertRule or array of AlertRules", http.StatusBadRequest)

		case http.MethodDelete:
			ruleID := r.URL.Query().Get("ruleId")
			if ruleID == "" {
				http.Error(w, "ruleId query parameter required", http.StatusBadRequest)
				return
			}

			removed := metricEvaluator.RemoveRule(ruleID)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "deleted",
				"ruleId":  ruleID,
				"success": removed,
			})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// ── Resource Declarative Apply & Delete REST Endpoints ─────────────────────
	//
	// POST   /api/v1/resource/apply  — re-manifest/apply a Kubernetes resource
	// DELETE /api/v1/resource/delete — delete a Kubernetes resource
	//
	type resourceApplyRequest struct {
		ClusterID    string                 `json:"clusterId"`
		Namespace    string                 `json:"namespace"`
		ResourceKind string                 `json:"resourceKind"`
		ResourceName string                 `json:"resourceName"`
		Manifest     map[string]interface{} `json:"manifest"`
	}

	mux.HandleFunc("/api/v1/resource/apply", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}
		var req resourceApplyRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}
		if req.ClusterID == "" || req.ResourceName == "" {
			http.Error(w, "clusterId and resourceName are required", http.StatusBadRequest)
			return
		}

		// Sanitize manifest metadata before re-application to prevent kube-apiserver rejection
		if req.Manifest != nil {
			if meta, ok := req.Manifest["metadata"].(map[string]interface{}); ok {
				delete(meta, "resourceVersion")
				delete(meta, "uid")
				delete(meta, "creationTimestamp")
				delete(meta, "generation")
				delete(meta, "managedFields")
			}
			delete(req.Manifest, "status")
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "applied",
			"clusterId":    req.ClusterID,
			"namespace":    req.Namespace,
			"resourceKind": req.ResourceKind,
			"resourceName": req.ResourceName,
			"timestamp":    time.Now().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/api/v1/resource/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete && r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}
		var req resourceApplyRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}
		if req.ClusterID == "" || req.ResourceName == "" {
			http.Error(w, "clusterId and resourceName are required", http.StatusBadRequest)
			return
		}

		ns := req.Namespace
		if ns == "" {
			ns = "default"
		}

		clientset, err := clusterManager.GetClientset(req.ClusterID)
		if err != nil {
			log.Printf("[Warning] Deletion fallback — cluster %s clientset unavailable: %v", req.ClusterID, err)
		} else if clientset != nil {
			kind := strings.ToLower(req.ResourceKind)
			ctx := r.Context()
			deleteOpts := metav1.DeleteOptions{}

			switch {
			case kind == "pod" || kind == "k8spod":
				err = clientset.CoreV1().Pods(ns).Delete(ctx, req.ResourceName, deleteOpts)
			case kind == "service" || kind == "k8sservice":
				err = clientset.CoreV1().Services(ns).Delete(ctx, req.ResourceName, deleteOpts)
			case kind == "deployment" || kind == "k8sdeployment" || kind == "workload" || kind == "k8sworkload":
				err = clientset.AppsV1().Deployments(ns).Delete(ctx, req.ResourceName, deleteOpts)
			case kind == "statefulset" || kind == "k8sstatefulset":
				err = clientset.AppsV1().StatefulSets(ns).Delete(ctx, req.ResourceName, deleteOpts)
			case kind == "replicaset" || kind == "k8sreplicaset":
				err = clientset.AppsV1().ReplicaSets(ns).Delete(ctx, req.ResourceName, deleteOpts)
			case kind == "ingress" || kind == "k8singress":
				err = clientset.NetworkingV1().Ingresses(ns).Delete(ctx, req.ResourceName, deleteOpts)
			default:
				log.Printf("[Warning] Unhandled resourceKind for client-go deletion: %s", req.ResourceKind)
			}

			if err != nil && !strings.Contains(err.Error(), "not found") {
				log.Printf("[Error] Physical Kubernetes deletion failed for %s/%s in %s: %v", req.ResourceKind, req.ResourceName, ns, err)
			} else {
				log.Printf("[K8s Engine] Successfully physically deleted %s/%s from namespace %s (cluster: %s)", req.ResourceKind, req.ResourceName, ns, req.ClusterID)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "deleted",
			"clusterId":    req.ClusterID,
			"namespace":    ns,
			"resourceKind": req.ResourceKind,
			"resourceName": req.ResourceName,
			"timestamp":    time.Now().Format(time.RFC3339),
		})
	})

	corsHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-Requested-With")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		mux.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      corsHandler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Channel to signal server shutdown
	serverErrors := make(chan error, 1)

	go func() {
		log.Printf("[HTTP Server] Listening on http://localhost:%s", port)
		log.Printf("[WebSocket Server] Gateway endpoint available at ws://localhost:%s/ws/k8s", port)
		serverErrors <- server.ListenAndServe()
	}()

	// Signal channel to trap OS interrupts
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		log.Fatalf("Critical server error: %v", err)

	case sig := <-shutdown:
		log.Printf("[Shutdown] Signal received: %v. Initiating graceful shutdown...", sig)

		// Stop Metric Evaluator
		metricEvaluator.Stop()

		// Stop all active log streams before shutting down cluster informers
		for clusterID := range clusterManager.ListClusters() {
			logStreamer.StopAllForCluster(clusterID)
		}
		// Stop all active cluster informers
		clusterManager.ShutdownAll()

		// Stop Redis adapter if active
		if redisAdapter != nil {
			redisAdapter.Stop()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[Shutdown] Error during server shutdown: %v", err)
			_ = server.Close()
		}
		log.Println("[Shutdown] Server gracefully stopped")
	}
}
