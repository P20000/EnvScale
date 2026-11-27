package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/executor"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/server"
	ws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestLegacyLogsStreamEndpointRetiredAndRBAC403Denied(t *testing.T) {
	const jwtSecret = "adversarial_route_auth_test_secret_123456"
	t.Setenv("JWT_ACCESS_SECRET", jwtSecret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")
	defer os.Unsetenv("ALLOW_ANONYMOUS_WS")

	k8sForbiddenSrv := newSecurityMockK8s(t, true)
	defer k8sForbiddenSrv.Close()
	cs, err := kubernetes.NewForConfig(&rest.Config{Host: k8sForbiddenSrv.URL, QPS: 100, Burst: 200})
	if err != nil {
		t.Fatalf("clientset err: %v", err)
	}

	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	im := cm.RegisterWithClientset("c-forbid", cs)
	defer im.Stop()

	mux := http.NewServeMux()
	server.SetupRoutes(mux, hub, cm, k8s.NewPodLogStreamer(hub), chaos.NewInjector(cm, hub), k8s.NewMetricEvaluator(cm, hub), nil)

	srv := httptest.NewServer(mux)
	defer srv.Close()

	validTok := signTestJWT(t, jwtSecret, jwt.MapClaims{
		"sub":               "user-1",
		"tokenType":         "user",
		"allowedClusterIds": []string{"c-forbid"},
		"exp":               time.Now().Add(5 * time.Minute).Unix(),
	})

	// 1. Legacy /api/v1/logs/stream fails closed on auth/cluster and returns 410 Gone otherwise
	respUnauth, _ := http.Post(srv.URL+"/api/v1/logs/stream", "application/json", nil)
	respUnauth.Body.Close()
	if respUnauth.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthenticated on legacy route, got %d", respUnauth.StatusCode)
	}

	reqWrongCluster, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/logs/stream?clusterId=other-cluster", nil)
	reqWrongCluster.Header.Set("Authorization", "Bearer "+validTok)
	respWrong, _ := http.DefaultClient.Do(reqWrongCluster)
	respWrong.Body.Close()
	if respWrong.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized cluster on legacy route, got %d", respWrong.StatusCode)
	}

	reqLegacyValid, _ := http.NewRequest(http.MethodPost, srv.URL+"/api/v1/logs/stream?clusterId=c-forbid", nil)
	reqLegacyValid.Header.Set("Authorization", "Bearer "+validTok)
	respLegacy, _ := http.DefaultClient.Do(reqLegacyValid)
	defer respLegacy.Body.Close()
	if respLegacy.StatusCode != http.StatusGone {
		t.Fatalf("expected 410 Gone for retired legacy /api/v1/logs/stream, got %d", respLegacy.StatusCode)
	}
	var goneBody map[string]string
	_ = json.NewDecoder(respLegacy.Body).Decode(&goneBody)
	if goneBody["replacement"] != "/api/v1/stream/logs" {
		t.Fatalf("expected replacement /api/v1/stream/logs in 410 payload, got %+v", goneBody)
	}

	// 2. Container parameter cannot bypass RBAC or path validation on /api/v1/stream/logs
	reqTraversal, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/stream/logs?clusterId=c-forbid&namespace=prod&kind=pod&name=api-0&container=../../etc", nil)
	reqTraversal.Header.Set("Authorization", "Bearer "+validTok)
	respTrav, _ := http.DefaultClient.Do(reqTraversal)
	respTrav.Body.Close()
	if respTrav.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for container traversal, got %d", respTrav.StatusCode)
	}

	// 3. Valid pod + container when K8s RBAC denies pods/log emits permission_denied without fake logs
	wsURL, _ := url.Parse(srv.URL + "/api/v1/stream/logs")
	wsURL.Scheme = "ws"
	wsURL.RawQuery = "clusterId=c-forbid&namespace=prod&kind=pod&name=api-0&container=api&follow=false"
	cConn, cResp, cErr := websocket.DefaultDialer.Dial(wsURL.String(), http.Header{"Authorization": []string{"Bearer " + validTok}})
	if cResp != nil && cResp.Body != nil {
		_ = cResp.Body.Close()
	}
	if cErr != nil {
		t.Fatalf("ws dial failed: %v", cErr)
	}
	defer cConn.Close()

	_ = cConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	sawDenied := false
	for {
		var f executor.LogFrame
		if err := cConn.ReadJSON(&f); err != nil {
			break
		}
		if f.Type == "log" {
			t.Fatalf("must not emit fake logs on RBAC 403, got %+v", f)
		}
		if f.Type == "error" && f.Code == "permission_denied" {
			sawDenied = true
			break
		}
	}
	if !sawDenied {
		t.Fatalf("expected explicit permission_denied error frame when K8s denies pods/log")
	}
}

