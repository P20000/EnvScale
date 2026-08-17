package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

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

	mux := http.NewServeMux()

	// Health Check Endpoint
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":        "ok",
			"service":       "k8s-streamer",
			"activeClients": hub.ClientCount(),
			"timestamp":     time.Now().UTC().Format(time.RFC3339),
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

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(ctx); err != nil {
			log.Printf("[Shutdown] Error during server shutdown: %v", err)
			_ = server.Close()
		}
		log.Println("[Shutdown] Server gracefully stopped")
	}
}
