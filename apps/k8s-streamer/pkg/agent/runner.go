package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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

	"github.com/EnvScale/k8s-streamer/pkg/executor"
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
	CACertPath     string
	CACertPEM      string
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

	caCertPath := os.Getenv("CA_CERT_PATH")
	if caCertPath == "" {
		caCertPath = os.Getenv("ENVSCALE_CA_CERT_PATH")
	}
	caCertPEM := os.Getenv("CA_CERT_PEM")
	if caCertPEM == "" {
		caCertPEM = os.Getenv("ENVSCALE_CA_CERT_PEM")
	}

	return Config{
		ClusterID:      clusterID,
		ServerURL:      serverURL,
		Token:          token,
		KubeconfigPath: os.Getenv("KUBECONFIG"),
		CACertPath:     caCertPath,
		CACertPEM:      caCertPEM,
	}
}

// buildAgentTLSConfig constructs a strict TLS configuration using the system trust store
// and an optional explicitly configured CA certificate path or PEM bundle.
func buildAgentTLSConfig(caCertPath, caCertPEM string) (*tls.Config, error) {
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}

	if caCertPath != "" {
		pemBytes, err := os.ReadFile(caCertPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read CA_CERT_PATH %q: %w", caCertPath, err)
		}
		if !pool.AppendCertsFromPEM(pemBytes) {
			return nil, fmt.Errorf("CA_CERT_PATH %q contains no valid PEM certificates", caCertPath)
		}
	}

	if caCertPEM != "" {
		if !pool.AppendCertsFromPEM([]byte(caCertPEM)) {
			return nil, fmt.Errorf("CA_CERT_PEM contains no valid PEM certificates")
		}
	}

	return &tls.Config{
		RootCAs:            pool,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: false,
	}, nil
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
	_ = reconcileAgentCapabilities(context.Background(), cfg.ClusterID, informerMgr)

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
	parsedURL.RawQuery = q.Encode()

	headers := http.Header{}
	if cfg.Token != "" {
		headers.Set("Authorization", "Bearer "+cfg.Token)
	}

	sanitizedURL := fmt.Sprintf("%s://%s%s?clusterId=%s", parsedURL.Scheme, parsedURL.Host, parsedURL.Path, url.QueryEscape(cfg.ClusterID))

	tlsCfg, tlsErr := buildAgentTLSConfig(cfg.CACertPath, cfg.CACertPEM)
	if tlsErr != nil {
		log.Fatalf("[Agent] Invalid TLS CA configuration: %v", tlsErr)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 15 * time.Second,
		TLSClientConfig:  tlsCfg,
	}

	backoff := 2 * time.Second
	maxBackoff := 30 * time.Second

	for {
		log.Printf("[Agent] Connecting outbound to %s...", sanitizedURL)
		conn, resp, err := dialer.Dial(parsedURL.String(), headers)
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err != nil {
			if resp != nil {
				log.Printf("[Agent] Handshake failed (HTTP %d): %v. Retrying in %v...", resp.StatusCode, err, backoff)
			} else {
				log.Printf("[Agent] Dial error: %v. Retrying in %v...", err, backoff)
			}
			select {
			case <-stopSig:
				log.Println("[Agent] Shutdown signal received during reconnect backoff.")
				return
			case <-time.After(backoff):
			}
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
		resyncCount := 0
		active := true

		for active {
			select {
			case <-stopSig:
				log.Println("[Agent] Shutdown signal received; closing outbound WebSocket.")
				resyncTicker.Stop()
				pingTicker.Stop()
				_ = conn.Close()
				return

			case <-done:
				active = false

			case <-resyncTicker.C:
				resyncCount++
				if resyncCount%4 == 0 && im.Clientset() != nil {
					_ = reconcileAgentCapabilities(context.Background(), cfg.ClusterID, im)
				}
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
		select {
		case <-stopSig:
			log.Println("[Agent] Shutdown signal received during reconnect backoff.")
			return
		case <-time.After(backoff):
		}
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

// reconcileAgentCapabilities probes permissions strictly using the Agent's own Kubernetes clientset
// identity (never control-plane/API-server service tokens) and reconciles live informers without
// revoking healthy capabilities on transient probe failures.
func reconcileAgentCapabilities(ctx context.Context, clusterID string, im *k8s.InformerManager) executor.ClusterCapabilities {
	if im == nil {
		return executor.ProbeDirectCapabilities(ctx, clusterID, nil, false)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	caps := executor.ProbeDirectCapabilities(probeCtx, clusterID, im.Clientset(), im.WatchSecrets())
	if caps.ConnectionState != executor.StateDisconnected && len(caps.Resources) > 0 {
		if !im.IsRunning() {
			im.SetAllowedResources(executor.AllowedResourceMap(caps))
			im.SetMetricsAllowed(caps.Capabilities[executor.CapMetrics].State == executor.CapSupportedWorking)
		} else {
			merged := executor.MergeReconciledAllowedResources(im.AllowedResources(), caps)
			im.ReconcileAllowedResources(merged)
			if mState := caps.Capabilities[executor.CapMetrics].State; mState != executor.CapTemporarilyUnavailable {
				im.SetMetricsAllowed(mState == executor.CapSupportedWorking)
			}
		}
	}
	return caps
}
