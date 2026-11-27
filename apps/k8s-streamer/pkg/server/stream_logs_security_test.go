package server_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/EnvScale/k8s-streamer/pkg/agent"
	"github.com/EnvScale/k8s-streamer/pkg/executor"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/server"
	ws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func signTestJWT(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to sign JWT: %v", err)
	}
	return signed
}

func newSecurityMockK8s(t *testing.T, forbidLogs bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api":
			_, _ = w.Write([]byte(`{"kind":"APIVersions","versions":["v1"]}`))
		case r.URL.Path == "/apis":
			_, _ = w.Write([]byte(`{"kind":"APIGroupList","apiVersion":"v1","groups":[{"name":"authorization.k8s.io","versions":[{"groupVersion":"authorization.k8s.io/v1","version":"v1"}]}]}`))
		case r.URL.Path == "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews":
			allowed := !forbidLogs
			_, _ = fmt.Fprintf(w, `{"kind":"SelfSubjectAccessReview","apiVersion":"authorization.k8s.io/v1","status":{"allowed":%v}}`, allowed)
		case r.URL.Path == "/api/v1/namespaces/prod/pods/api-0":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "prod"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "api"}}},
			})
		case r.URL.Path == "/api/v1/namespaces/prod/pods/api-0/log":
			if forbidLogs {
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","code":403}`))
				return
			}
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("2026-11-27T13:00:00Z INFO secure log line\n"))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			if r.URL.Query().Get("follow") == "true" {
				<-r.Context().Done()
			}
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestHandleUniversalLogStream_SecurityAndValidation(t *testing.T) {
	const jwtSecret = "super_secure_log_stream_test_secret_123456"
	t.Setenv("JWT_ACCESS_SECRET", jwtSecret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")
	defer os.Unsetenv("ALLOW_ANONYMOUS_WS")

	k8sSrv := newSecurityMockK8s(t, false)
	defer k8sSrv.Close()
	cs, err := kubernetes.NewForConfig(&rest.Config{Host: k8sSrv.URL, QPS: 100, Burst: 200})
	if err != nil {
		t.Fatalf("clientset err: %v", err)
	}

	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	im := cm.RegisterWithClientset("cluster-authorized", cs)
	defer im.Stop()
	factory := executor.NewClusterExecutorFactory(cm)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.HandleUniversalLogStream(factory, w, r)
	}))
	defer srv.Close()

	userOtherToken := signTestJWT(t, jwtSecret, jwt.MapClaims{
		"sub":               "user-attacker",
		"tokenType":         "user",
		"allowedClusterIds": []string{"other-cluster"},
		"exp":               time.Now().Add(5 * time.Minute).Unix(),
	})
	userValidToken := signTestJWT(t, jwtSecret, jwt.MapClaims{
		"sub":               "user-1",
		"tokenType":         "user",
		"allowedClusterIds": []string{"cluster-authorized", "agent-authorized", "unregistered-authorized"},
		"exp":               time.Now().Add(5 * time.Minute).Unix(),
	})

	// 1. Unauthenticated -> 401
	res, err := http.Get(srv.URL + "?clusterId=cluster-authorized&namespace=prod&kind=pod&name=api-0")
	if err != nil {
		t.Fatalf("http get failed: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated request, got %d", res.StatusCode)
	}

	// 2. Unauthorized cluster -> 403
	reqAuthz, _ := http.NewRequest(http.MethodGet, srv.URL+"?clusterId=cluster-authorized&namespace=prod&kind=pod&name=api-0", nil)
	reqAuthz.Header.Set("Authorization", "Bearer "+userOtherToken)
	resAuthz, err := http.DefaultClient.Do(reqAuthz)
	if err != nil {
		t.Fatalf("http do failed: %v", err)
	}
	resAuthz.Body.Close()
	if resAuthz.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized cluster access, got %d", resAuthz.StatusCode)
	}

	// 3. Invalid inputs -> 400 Bad Request
	invalidQueries := []string{
		"?clusterId=cluster-authorized&namespace=../kube-system&kind=pod&name=api-0",
		"?clusterId=cluster-authorized&namespace=PROD&kind=pod&name=api-0",
		"?clusterId=cluster-authorized&namespace=prod&kind=pod&name=bad/pod",
		"?clusterId=cluster-authorized&namespace=prod&kind=pod&name=api-0&container=bad$cont",
		"?clusterId=cluster-authorized&namespace=prod&kind=secret&name=db-creds",
		"?clusterId=cluster-authorized&namespace=prod&kind=pod&name=api-0&sinceSeconds=0",
	}
	for _, q := range invalidQueries {
		rInvalid, _ := http.NewRequest(http.MethodGet, srv.URL+q, nil)
		rInvalid.Header.Set("Authorization", "Bearer "+userValidToken)
		respInv, rErr := http.DefaultClient.Do(rInvalid)
		if rErr != nil {
			t.Fatalf("invalid query request failed: %v", rErr)
		}
		respInv.Body.Close()
		if respInv.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for query %q, got %d", q, respInv.StatusCode)
		}
	}

	// 4a. Unknown clusterId without claim -> 403 Forbidden (fail-closed)
	rForbiddenUnknown, _ := http.NewRequest(http.MethodGet, srv.URL+"?clusterId=nonexistent&namespace=prod&kind=pod&name=api-0", nil)
	rForbiddenUnknown.Header.Set("Authorization", "Bearer "+userValidToken)
	respFU, _ := http.DefaultClient.Do(rForbiddenUnknown)
	respFU.Body.Close()
	if respFU.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for unauthorized unknown clusterId, got %d", respFU.StatusCode)
	}

	// 4b. Authorized claim for unregistered clusterId -> 404 Not Found
	rNotFound, _ := http.NewRequest(http.MethodGet, srv.URL+"?clusterId=unregistered-authorized&namespace=prod&kind=pod&name=api-0", nil)
	rNotFound.Header.Set("Authorization", "Bearer "+userValidToken)
	respNF, _ := http.DefaultClient.Do(rNotFound)
	respNF.Body.Close()
	if respNF.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for authorized unregistered clusterId, got %d", respNF.StatusCode)
	}

	// 5. Authorized user over WebSocket through /api/v1/stream/logs -> Agent v2.0 end-to-end + cancellation
	agentToken := signTestJWT(t, jwtSecret, jwt.MapClaims{
		"tokenType": "agent",
		"clusterId": "agent-authorized",
		"exp":       time.Now().Add(5 * time.Minute).Unix(),
	})
	agentSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.HandleAgentWebSocket(hub, cm, w, r)
	}))
	defer agentSrv.Close()

	au, _ := url.Parse(agentSrv.URL)
	au.Scheme = "ws"
	au.RawQuery = "clusterId=agent-authorized"
	aHdr := http.Header{"Authorization": []string{"Bearer " + agentToken}}
	aConn, aResp, aErr := websocket.DefaultDialer.Dial(au.String(), aHdr)
	if aResp != nil && aResp.Body != nil {
		_ = aResp.Body.Close()
	}
	if aErr != nil {
		t.Fatalf("agent dial failed: %v", aErr)
	}
	agentIM := k8s.NewInformerManagerWithClientset(cs, ws.NewHub(), "agent-authorized")
	aCtx, aCancel := context.WithCancel(context.Background())
	var aWG sync.WaitGroup
	aWG.Add(1)
	go func() {
		defer aWG.Done()
		agent.RunSession(aCtx, aConn, agent.Config{ClusterID: "agent-authorized"}, agentIM, make(chan []byte, 32))
	}()
	defer func() {
		aCancel()
		_ = aConn.Close()
		aWG.Wait()
	}()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		meta, ok := cm.AgentRegistry().GetStateMeta("agent-authorized")
		if ok && meta.Connected && meta.ProtocolVersion == "2.0" {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}

	wsURL, _ := url.Parse(srv.URL)
	wsURL.Scheme = "ws"
	wsURL.RawQuery = "clusterId=agent-authorized&namespace=prod&kind=pod&name=api-0&container=api&follow=true"
	hdr := http.Header{"Authorization": []string{"Bearer " + userValidToken}}
	clientConn, cResp, cErr := websocket.DefaultDialer.Dial(wsURL.String(), hdr)
	if cResp != nil && cResp.Body != nil {
		_ = cResp.Body.Close()
	}
	if cErr != nil {
		t.Fatalf("client ws dial failed: %v", cErr)
	}

	gotLog := false
	_ = clientConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for !gotLog {
		var frame executor.LogFrame
		if err := clientConn.ReadJSON(&frame); err != nil {
			t.Fatalf("client ReadJSON failed: %v", err)
		}
		if frame.Type == "log" && strings.Contains(frame.Message, "secure log line") {
			gotLog = true
		}
	}
	// Send cancel and close browser WebSocket cleanly
	_ = clientConn.WriteJSON(map[string]string{"type": "cancel"})
	_ = clientConn.Close()
}
