package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/EnvScale/k8s-streamer/pkg/executor"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func buildMockAgentK8sServer(t *testing.T, expectedK8sToken, forbiddenPlatformToken string, authFailures *atomic.Int64, nodesAllowed, force429, failDiscovery *atomic.Bool) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if strings.Contains(auth, forbiddenPlatformToken) || auth != "Bearer "+expectedK8sToken {
			authFailures.Add(1)
			http.Error(w, "unauthorized identity", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path

		if path == "/api" || path == "/apis" {
			if failDiscovery.Load() {
				http.Error(w, "apiserver temporarily unavailable", http.StatusServiceUnavailable)
				return
			}
			if path == "/api" {
				_ = json.NewEncoder(w).Encode(metav1.APIVersions{Versions: []string{"v1"}})
				return
			}
			_ = json.NewEncoder(w).Encode(metav1.APIGroupList{
				Groups: []metav1.APIGroup{
					{Name: "apps", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "apps/v1", Version: "v1"}}},
					{Name: "authorization.k8s.io", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "authorization.k8s.io/v1", Version: "v1"}}},
				},
			})
			return
		}

		if path == "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews" && r.Method == http.MethodPost {
			if force429.Load() {
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(metav1.Status{Status: "Failure", Reason: metav1.StatusReasonTooManyRequests, Code: http.StatusTooManyRequests})
				return
			}
			body, _ := io.ReadAll(r.Body)
			var sar authorizationv1.SelfSubjectAccessReview
			_ = json.Unmarshal(body, &sar)
			allowed := true
			if sar.Spec.ResourceAttributes != nil && sar.Spec.ResourceAttributes.Group == "" && sar.Spec.ResourceAttributes.Resource == "nodes" {
				allowed = nodesAllowed.Load()
			}
			sar.Status.Allowed = allowed
			_ = json.NewEncoder(w).Encode(sar)
			return
		}

		if r.URL.Query().Get("watch") == "true" {
			w.WriteHeader(http.StatusOK)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			<-r.Context().Done()
			return
		}

		switch path {
		case "/api/v1/pods":
			_ = json.NewEncoder(w).Encode(corev1.PodList{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"},
				ListMeta: metav1.ListMeta{ResourceVersion: "10"},
				Items: []corev1.Pod{{
					ObjectMeta: metav1.ObjectMeta{Name: "agent-app-1", Namespace: "default"},
					Status:     corev1.PodStatus{Phase: corev1.PodRunning},
				}},
			})
		case "/api/v1/nodes":
			if !nodesAllowed.Load() {
				w.WriteHeader(http.StatusForbidden)
				_ = json.NewEncoder(w).Encode(metav1.Status{Status: "Failure", Reason: metav1.StatusReasonForbidden, Code: http.StatusForbidden})
				return
			}
			_ = json.NewEncoder(w).Encode(corev1.NodeList{
				TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "NodeList"},
				ListMeta: metav1.ListMeta{ResourceVersion: "11"},
				Items: []corev1.Node{{
					ObjectMeta: metav1.ObjectMeta{Name: "agent-node-1"},
					Status:     corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}}},
				}},
			})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"apiVersion": "v1",
				"kind":       "List",
				"metadata":   map[string]string{"resourceVersion": "1"},
				"items":      []any{},
			})
		}
	}))
}

func TestAgentCapabilityIdentityAndReconciliation(t *testing.T) {
	const (
		agentK8sToken    = "agent-k8s-serviceaccount-token"
		platformAPIToken = "envscale-control-plane-service-jwt"
	)
	var authFailures atomic.Int64
	var nodesAllowed atomic.Bool
	var force429 atomic.Bool
	var failDiscovery atomic.Bool

	srv := buildMockAgentK8sServer(t, agentK8sToken, platformAPIToken, &authFailures, &nodesAllowed, &force429, &failDiscovery)
	defer srv.Close()

	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())

	clientset, err := kubernetes.NewForConfig(&rest.Config{
		Host:        srv.URL,
		BearerToken: agentK8sToken,
		TLSClientConfig: rest.TLSClientConfig{
			NextProtos: []string{"http/1.1"},
		},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		},
	})
	if err != nil {
		t.Fatalf("failed building agent clientset: %v", err)
	}

	hub := websocket.NewHub()
	im := k8s.NewInformerManagerWithClientset(clientset, hub, "cluster-agent-id")
	defer im.Stop()

	// 1. Initial probe uses Agent K8s token; nodes denied -> nodes excluded, pods permitted.
	caps1 := reconcileAgentCapabilities(context.Background(), "cluster-agent-id", im)
	if authFailures.Load() != 0 {
		t.Fatalf("expected all discovery/SSAR requests to use Agent K8s identity, saw %d unauthorized requests", authFailures.Load())
	}
	if caps1.Resources["core/v1/nodes"].State != executor.CapPermissionDenied {
		t.Fatalf("expected nodes=permission_denied, got %+v", caps1.Resources["core/v1/nodes"])
	}
	if caps1.Capabilities[executor.CapTopology].State != executor.CapSupportedWorking {
		t.Fatalf("expected topology=supported_working, got %+v", caps1.Capabilities[executor.CapTopology])
	}

	stopCh := make(chan struct{})
	var closeOnce sync.Once
	defer closeOnce.Do(func() { close(stopCh) })
	go im.Start(stopCh)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	deadline := time.Now().Add(2 * time.Second)
	for {
		pods, nodes, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
		if len(pods) == 1 && pods[0].Name == "agent-app-1" {
			if nodes != nil {
				t.Fatalf("expected nodes==nil while denied, got %#v", nodes)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for initial pods sync; got %+v", pods)
		}
		time.Sleep(15 * time.Millisecond)
	}

	// 2. Transient 429 during periodic reconciliation must NOT revoke healthy pods informer.
	force429.Store(true)
	caps429 := reconcileAgentCapabilities(context.Background(), "cluster-agent-id", im)
	if caps429.Capabilities[executor.CapTopology].State != executor.CapTemporarilyUnavailable {
		t.Fatalf("expected truthful CapTopology=temporarily_unavailable on 429, got %+v", caps429.Capabilities[executor.CapTopology])
	}
	podsAfter429, _, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
	if len(podsAfter429) != 1 || podsAfter429[0].Name != "agent-app-1" {
		t.Fatalf("expected healthy pods informer preserved across 429, got %+v", podsAfter429)
	}
	force429.Store(false)

	// 3. Transient discovery failure must NOT revoke healthy pods informer.
	failDiscovery.Store(true)
	capsDisc := reconcileAgentCapabilities(context.Background(), "cluster-agent-id", im)
	if capsDisc.ConnectionState != executor.StateDisconnected {
		t.Fatalf("expected ConnectionState=disconnected during discovery failure, got %q", capsDisc.ConnectionState)
	}
	podsAfterDisc, _, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
	if len(podsAfterDisc) != 1 || podsAfterDisc[0].Name != "agent-app-1" {
		t.Fatalf("expected healthy pods informer preserved during discovery blip, got %+v", podsAfterDisc)
	}
	failDiscovery.Store(false)

	// 4. RBAC recovery: grant nodes permission and reconcile -> nodes activates cleanly using Agent K8s identity.
	nodesAllowed.Store(true)
	capsRecov := reconcileAgentCapabilities(context.Background(), "cluster-agent-id", im)
	if capsRecov.Resources["core/v1/nodes"].State != executor.CapSupportedWorking {
		t.Fatalf("expected nodes=supported_working after recovery, got %+v", capsRecov.Resources["core/v1/nodes"])
	}
	deadline = time.Now().Add(2 * time.Second)
	for {
		_, nodesRecov, _, _, _, _, _, _, _, _, _, _, _, _, _ := im.GetSnapshotWithContext(ctx)
		if len(nodesRecov) == 1 && nodesRecov[0].Name == "agent-node-1" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for recovered node agent-node-1, got %+v", nodesRecov)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if authFailures.Load() != 0 {
		t.Fatalf("expected 0 unauthorized requests across full Agent probe/reconcile lifecycle, saw %d", authFailures.Load())
	}
}

