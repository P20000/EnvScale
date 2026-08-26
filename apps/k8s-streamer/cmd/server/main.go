package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	envredis "github.com/EnvScale/k8s-streamer/pkg/redis"
	"github.com/EnvScale/k8s-streamer/pkg/server"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func main() {
	log.Println("==================================================")
	log.Println(" Starting EnvScale K8s WebSocket Streaming Gateway")
	log.Println("==================================================")

	if err := godotenv.Load(); err != nil {
		log.Println("[Config] No .env file found; using default environment variables")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	hub := websocket.NewHub()
	go hub.Run()
	log.Println("[WebSocket Hub] Streaming event hub initialized and running")

	clusterManager := k8s.NewClusterManager(hub)
	log.Println("[ClusterManager] Dynamic multi-tenant cluster registry initialized")

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

	logStreamer := k8s.NewPodLogStreamer(hub)
	log.Println("[LogStreamer] Pod log streaming engine initialized")

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

	chaosInjector := chaos.NewInjector(clusterManager, hub)
	log.Println("[Chaos Engine] Fault injection engine initialized")

	metricEvaluator := k8s.NewMetricEvaluator(clusterManager, hub)
	metricEvaluator.Start()

	mux := http.NewServeMux()

	server.SetupRoutes(
		mux,
		hub,
		clusterManager,
		logStreamer,
		chaosInjector,
		metricEvaluator,
		redisAdapter,
	)

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

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      corsHandler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Printf("[HTTP Server] Listening on http://localhost:%s", port)
		log.Printf("[WebSocket Server] Gateway endpoint available at ws://localhost:%s/ws/k8s", port)
		serverErrors <- srv.ListenAndServe()
	}()

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		log.Fatalf("Critical server error: %v", err)

	case sig := <-shutdown:
		log.Printf("[Shutdown] Signal received: %v. Initiating graceful shutdown...", sig)
		metricEvaluator.Stop()

		for clusterID := range clusterManager.ListClusters() {
			logStreamer.StopAllForCluster(clusterID)
		}
		clusterManager.ShutdownAll()

		if redisAdapter != nil {
			redisAdapter.Stop()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[Shutdown] Error during server shutdown: %v", err)
			_ = srv.Close()
		}
		log.Println("[Shutdown] Server gracefully stopped")
	}
}
