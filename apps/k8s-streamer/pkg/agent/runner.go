package agent

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	ws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// Config defines the in-cluster agent configuration
type Config struct {
	ClusterID      string
	ServerURL      string
	Token          string
	KubeconfigPath string
}

// LoadConfigFromEnv loads configuration from standard environment variables
func LoadConfigFromEnv() Config {
	clusterID := os.Getenv("CLUSTER_ID")
	if clusterID == "" {
		clusterID = os.Getenv("ENVSCALE_CLUSTER_ID")
	}

	serverURL := os.Getenv("SERVER_URL")
	if serverURL == "" {
		serverURL = os.Getenv("ENVSCALE_SERVER_URL")
	}
	if serverURL == "" {
		serverURL = "wss://envscale.duckdns.org/ws/agent"
	}

	token := os.Getenv("CLUSTER_TOKEN")
	if token == "" {
		token = os.Getenv("ENVSCALE_TOKEN")
	}

	return Config{
		ClusterID:      clusterID,
		ServerURL:      serverURL,
		Token:          token,
		KubeconfigPath: os.Getenv("KUBECONFIG"),
	}
}

// wsSender implements ws.EventPublisher to forward events over outbound WebSocket
type wsSender struct {
	msgCh chan []byte
}

func (s *wsSender) Publish(ctx context.Context, clusterID string, envelope types.WSEventEnvelope) {
	data, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	select {
	case s.msgCh <- data:
	default:
		// Queue full, drop old or discard to prevent memory leaks / blocking
	}
}

// Run executes the agent loop: connects to K8s informers and streams out to the EnvScale server
func Run(cfg Config) error {
	if cfg.ClusterID == "" {
		return fmt.Errorf("CLUSTER_ID is required for agent mode")
	}

	log.Printf("[Agent] Starting EnvScale In-Cluster Observability Agent...")
	log.Printf("[Agent] Target Cluster ID: %s", cfg.ClusterID)
	log.Printf("[Agent] Server Endpoint: %s", cfg.ServerURL)

	clientset, err := buildKubernetesClient(cfg.KubeconfigPath)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	serverVersion, err := clientset.Discovery().ServerVersion()
	if err != nil {
		log.Printf("[Agent] Warning: unable to query K8s server version: %v", err)
	} else {
		log.Printf("[Agent] Connected to Kubernetes API Server (version %s)", serverVersion.GitVersion)
	}

	hub := ws.NewHub()
	sender := &wsSender{msgCh: make(chan []byte, 1024)}
	hub.SetPublisher(sender)

	informerMgr := k8s.NewInformerManagerWithClientset(clientset, hub, cfg.ClusterID)
	stopInformers := make(chan struct{})
	defer close(stopInformers)

	go informerMgr.Start(stopInformers)
	log.Printf("[Agent] Kubernetes Informers initialized and caching resources...")

	// Allow informers 2 seconds to warm initial cache
	time.Sleep(2 * time.Second)

	stopAgent := make(chan os.Signal, 1)
	signal.Notify(stopAgent, os.Interrupt, syscall.SIGTERM)

	go runStreamingPipeline(cfg, informerMgr, sender.msgCh, stopAgent)

	sig := <-stopAgent
	log.Printf("[Agent] Received shutdown signal: %v. Gracefully stopping agent...", sig)
	informerMgr.Stop()
	return nil
}

// buildKubernetesClient tries in-cluster ServiceAccount first, then local kubeconfig
func buildKubernetesClient(kubeconfigPath string) (kubernetes.Interface, error) {
	// 1. Try In-Cluster ServiceAccount config
	inClusterConfig, inClusterErr := rest.InClusterConfig()
	if inClusterErr == nil {
		return kubernetes.NewForConfig(inClusterConfig)
	}

	// 2. Fallback to specified or default kubeconfig
	if kubeconfigPath == "" {
		if home := homedir.HomeDir(); home != "" {
			kubeconfigPath = filepath.Join(home, ".kube", "config")
		}
	}

	config, err := clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("in-cluster auth failed (%v) and kubeconfig '%s' failed: %w", inClusterErr, kubeconfigPath, err)
	}

	return kubernetes.NewForConfig(config)
}

// runStreamingPipeline maintains the outbound WebSocket connection with automatic backoff reconnection
func runStreamingPipeline(cfg Config, im *k8s.InformerManager, outCh <-chan []byte, stopSig chan os.Signal) {
	parsedURL, err := url.Parse(cfg.ServerURL)
	if err != nil {
		log.Fatalf("[Agent] Invalid SERVER_URL: %v", err)
	}

	q := parsedURL.Query()
	q.Set("clusterId", cfg.ClusterID)
	if cfg.Token != "" {
		q.Set("token", cfg.Token)
	}
	parsedURL.RawQuery = q.Encode()

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
		TLSClientConfig:  &tls.Config{InsecureSkipVerify: true}, // Allow custom/DuckDNS self-signed certs
	}

	backoff := 2 * time.Second
	maxBackoff := 30 * time.Second

	for {
		log.Printf("[Agent] Connecting outbound to %s...", parsedURL.String())
		conn, _, err := dialer.Dial(parsedURL.String(), nil)
		if err != nil {
			log.Printf("[Agent] Dial error: %v. Retrying in %v...", err, backoff)
			time.Sleep(backoff)
			backoff = backoff * 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}

		backoff = 2 * time.Second // Reset backoff on successful handshake
		log.Printf("[Agent] Successfully connected to EnvScale Cloud Platform!")

		// 1. Send initial baseline snapshot
		sendBaselineSnapshot(conn, im, cfg.ClusterID)

		// 2. Stream events until disconnected
		done := make(chan struct{})

		// Read pump to handle server pings/close frames
		go func() {
			defer close(done)
			for {
				_, _, err := conn.ReadMessage()
				if err != nil {
					log.Printf("[Agent] Server connection closed: %v", err)
					return
				}
			}
		}()

		// Write pump & periodic resync / ping
		resyncTicker := time.NewTicker(45 * time.Second)
		pingTicker := time.NewTicker(20 * time.Second)
		active := true

		for active {
			select {
			case <-done:
				active = false

			case <-resyncTicker.C:
				sendBaselineSnapshot(conn, im, cfg.ClusterID)

			case <-pingTicker.C:
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					active = false
				}

			case msg := <-outCh:
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					log.Printf("[Agent] Failed to send event delta: %v", err)
					active = false
				}
			}
		}

		resyncTicker.Stop()
		pingTicker.Stop()
		_ = conn.Close()
		log.Printf("[Agent] Disconnected from server. Reconnecting in %v...", backoff)
		time.Sleep(backoff)
	}
}

// sendBaselineSnapshot builds and sends the complete cluster snapshot over WebSocket
func sendBaselineSnapshot(conn *websocket.Conn, im *k8s.InformerManager, clusterID string) {
	snapshot := k8s.BuildClusterSnapshot(im)

	envelope := types.WSEventEnvelope{
		Event:     types.EventSnapshotSync,
		ClusterID: clusterID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Data:      snapshot,
	}

	payload, err := json.Marshal(envelope)
	if err != nil {
		log.Printf("[Agent] Failed to marshal baseline snapshot: %v", err)
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		log.Printf("[Agent] Error transmitting snapshot sync: %v", err)
	} else {
		log.Printf("[Agent] Transmitted baseline snapshot (%d pods, %d nodes, %d svcs, %d deps)",
			len(snapshot.Pods), len(snapshot.Nodes), len(snapshot.Services), len(snapshot.Deployments))
	}
}
