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

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

type registerClusterRequest struct {
	ClusterID       string `json:"clusterId"`
	Kubeconfig      string `json:"kubeconfig"`      // Base64 or raw YAML
	IsInClusterMode bool   `json:"isInClusterMode"` // Optional flag for in-cluster ServiceAccount mode
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

	mux := http.NewServeMux()

	// Health Check Endpoint
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":         "ok",
			"service":        "k8s-streamer",
			"activeClients":  hub.ClientCount(),
			"activeClusters": clusterManager.ActiveClusterCount(),
			"timestamp":      time.Now().UTC().Format(time.RFC3339),
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

	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
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

		// Stop all active cluster informers
		clusterManager.ShutdownAll()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[Shutdown] Error during server shutdown: %v", err)
			_ = server.Close()
		}
		log.Println("[Shutdown] Server gracefully stopped")
	}
}
