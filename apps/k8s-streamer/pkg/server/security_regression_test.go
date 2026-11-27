package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	gorillaws "github.com/gorilla/websocket"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func signTestJWT(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = time.Now().Add(time.Hour).Unix()
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed signing JWT: %v", err)
	}
	return s
}

func TestHandleAgentWebSocket_RejectsUserAndMismatchedAgentTokens(t *testing.T) {
	const secret = "test-jwt-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)

	userTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "user-1",
		"tokenType": "user",
		"clusterRoles": map[string]string{
			"cluster-victim": "ADMIN",
		},
	})
	reqUser := httptest.NewRequest(http.MethodGet, "/ws/agent?clusterId=cluster-victim", nil)
	reqUser.Header.Set("Authorization", "Bearer "+userTok)
	recUser := httptest.NewRecorder()
	HandleAgentWebSocket(hub, cm, recUser, reqUser)
	if recUser.Code != http.StatusForbidden {
		t.Fatalf("SEC-C2: expected user token on /ws/agent to return 403, got %d", recUser.Code)
	}

	otherAgentTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "agent-cluster-a",
		"tokenType": "agent",
		"clusterId": "cluster-a",
	})
	reqMismatch := httptest.NewRequest(http.MethodGet, "/ws/agent?clusterId=cluster-victim", nil)
	reqMismatch.Header.Set("Authorization", "Bearer "+otherAgentTok)
	recMismatch := httptest.NewRecorder()
	HandleAgentWebSocket(hub, cm, recMismatch, reqMismatch)
	if recMismatch.Code != http.StatusForbidden {
		t.Fatalf("SEC-C2: expected mismatched agent token on /ws/agent to return 403, got %d", recMismatch.Code)
	}
}

func TestDestructiveEndpoints_EnforceWorkspaceOperationRoles(t *testing.T) {
	const secret = "test-jwt-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	inj := chaos.NewInjector(cm, hub)
	logStreamer := k8s.NewPodLogStreamer(hub)
	eval := k8s.NewMetricEvaluator(cm, hub)

	mux := http.NewServeMux()
	SetupRoutes(mux, hub, cm, logStreamer, inj, eval, nil)

	viewerTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "viewer-1",
		"tokenType": "user",
		"clusterRoles": map[string]string{
			"cluster-1": "VIEWER",
		},
	})
	memberTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "member-1",
		"tokenType": "user",
		"clusterRoles": map[string]string{
			"cluster-1": "MEMBER",
		},
	})
	adminTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "admin-1",
		"tokenType": "user",
		"clusterRoles": map[string]string{
			"cluster-1": "ADMIN",
		},
	})
	agentTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "agent-cluster-1",
		"tokenType": "agent",
		"clusterId": "cluster-1",
		"role":      "ADMIN",
	})

	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/api/v1/chaos/inject", `{"clusterId":"cluster-1","namespace":"default","name":"pod-1","faultType":"crash"}`},
		{http.MethodPost, "/api/v1/resource/delete", `{"clusterId":"cluster-1","namespace":"default","resourceKind":"pod","resourceName":"pod-1"}`},
		{http.MethodPost, "/api/v1/clusters/cluster-1/rollout/rollback", `{"clusterId":"cluster-1","namespace":"default","deploymentName":"web","targetHash":"abc"}`},
		{http.MethodDelete, "/api/v1/clusters?clusterId=cluster-1", ""},
	}

	for _, tc := range endpoints {
		// VIEWER, MEMBER, and Agent tokens must all receive 403 on destructive endpoints
		for _, tok := range []string{viewerTok, memberTok, agentTok} {
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Authorization", "Bearer "+tok)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("SEC-C4: expected 403 on %s %s, got %d (body: %s)", tc.method, tc.path, rec.Code, rec.Body.String())
			}
		}

		// Admin query-param tokens must be rejected with 401 on destructive endpoints (Bearer-only)
		sep := "?"
		if strings.Contains(tc.path, "?") {
			sep = "&"
		}
		qReq := httptest.NewRequest(tc.method, tc.path+sep+"token="+adminTok, bytes.NewBufferString(tc.body))
		qReq.Header.Set("Content-Type", "application/json")
		qRec := httptest.NewRecorder()
		mux.ServeHTTP(qRec, qReq)
		if qRec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for ?token= query param on destructive %s %s, got %d", tc.method, tc.path, qRec.Code)
		}

		// Workspace ADMIN passes RBAC check (gets 404/500 downstream because cluster-1 isn't registered, never 401/403)
		aReq := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
		aReq.Header.Set("Authorization", "Bearer "+adminTok)
		aReq.Header.Set("Content-Type", "application/json")
		aRec := httptest.NewRecorder()
		mux.ServeHTTP(aRec, aReq)
		if aRec.Code == http.StatusUnauthorized || aRec.Code == http.StatusForbidden {
			t.Fatalf("expected workspace ADMIN to pass RBAC on %s %s, got %d", tc.method, tc.path, aRec.Code)
		}
	}
}

func TestUnregisterAll_RequiresServiceTokenAndRejectsInvalidTokens(t *testing.T) {
	const secret = "test-jwt-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "true")
	t.Setenv("NODE_ENV", "development")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	defer cm.ShutdownAll()

	mux := http.NewServeMux()
	SetupRoutes(mux, hub, cm, k8s.NewPodLogStreamer(hub), chaos.NewInjector(cm, hub), k8s.NewMetricEvaluator(cm, hub), nil)

	// Invalid Bearer token must be rejected 401 even when ALLOW_ANONYMOUS_WS=true
	badReq := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/unregister-all", nil)
	badReq.Header.Set("Authorization", "Bearer forged.jwt.token")
	badRec := httptest.NewRecorder()
	mux.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected invalid token to return 401 even when ALLOW_ANONYMOUS_WS=true, got %d", badRec.Code)
	}

	// Workspace ADMIN user token must receive 403 (service token only)
	adminTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "admin-1",
		"role":      "ADMIN",
		"tokenType": "user",
	})
	userReq := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/unregister-all", nil)
	userReq.Header.Set("Authorization", "Bearer "+adminTok)
	userRec := httptest.NewRecorder()
	mux.ServeHTTP(userRec, userReq)
	if userRec.Code != http.StatusForbidden {
		t.Fatalf("expected user ADMIN token to return 403 on unregister-all even in dev mode, got %d", userRec.Code)
	}

	// Strict mode without token -> 401
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")
	unauthReq := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/unregister-all", nil)
	unauthRec := httptest.NewRecorder()
	mux.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token on unregister-all, got %d", unauthRec.Code)
	}

	// Valid service token -> 200
	svcTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "api-server",
		"role":      "SERVICE",
		"tokenType": "service",
	})
	svcReq := httptest.NewRequest(http.MethodPost, "/api/v1/clusters/unregister-all", nil)
	svcReq.Header.Set("Authorization", "Bearer "+svcTok)
	svcRec := httptest.NewRecorder()
	mux.ServeHTTP(svcRec, svcReq)
	if svcRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid service token on unregister-all, got %d", svcRec.Code)
	}
}

func TestAgentHandshake_QueryTokenRejectedAndReconnectStaleSessionSafe(t *testing.T) {
	const secret = "test-jwt-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	defer cm.ShutdownAll()

	agentTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "agent-cluster-r",
		"tokenType": "agent",
		"clusterId": "cluster-r",
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/agent", func(w http.ResponseWriter, r *http.Request) {
		HandleAgentWebSocket(hub, cm, w, r)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// ?token= in URL query string must be rejected with 401 on /ws/agent
	qReq := httptest.NewRequest(http.MethodGet, "/ws/agent?clusterId=cluster-r&token="+agentTok, nil)
	qRec := httptest.NewRecorder()
	HandleAgentWebSocket(hub, cm, qRec, qReq)
	if qRec.Code != http.StatusUnauthorized {
		t.Fatalf("SEC-H4: expected /ws/agent to reject ?token= query param with 401, got %d", qRec.Code)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/agent?clusterId=cluster-r"
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+agentTok)

	conn1, _, err := gorillaws.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		t.Fatalf("expected agent session 1 handshake to succeed, got: %v", err)
	}
	if !cm.AgentRegistry().IsConnected("cluster-r") {
		t.Fatalf("expected cluster-r to be connected after session 1")
	}

	// Reconnect session 2 while session 1 is still open; then close stale session 1
	conn2, _, err := gorillaws.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		conn1.Close()
		t.Fatalf("expected agent session 2 reconnect to succeed, got: %v", err)
	}

	_ = conn1.Close()
	time.Sleep(50 * time.Millisecond)

	if !cm.AgentRegistry().IsConnected("cluster-r") {
		conn2.Close()
		t.Fatalf("stale session 1 disconnect must NOT mark active session 2 as disconnected")
	}

	_ = conn2.Close()
	deadline := time.Now().Add(time.Second)
	for cm.AgentRegistry().IsConnected("cluster-r") && time.Now().Before(deadline) {
		time.Sleep(15 * time.Millisecond)
	}
	if cm.AgentRegistry().IsConnected("cluster-r") {
		t.Fatalf("expected cluster-r to be disconnected after active session 2 closed")
	}
}

func TestChaosEndpoints_ScopedDeleteAndList(t *testing.T) {
	const secret = "test-jwt-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	defer cm.ShutdownAll()

	podA := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "default"}}
	cm.RegisterWithClientset("cluster-a", fake.NewSimpleClientset(podA))

	inj := chaos.NewInjector(cm, hub)
	faultID, err := inj.InjectFault(context.Background(), "cluster-a", "default", "pod-a", chaos.FaultCrash, true)
	if err != nil {
		t.Fatalf("failed injecting fault for test setup: %v", err)
	}

	mux := http.NewServeMux()
	SetupRoutes(mux, hub, cm, k8s.NewPodLogStreamer(hub), inj, k8s.NewMetricEvaluator(cm, hub), nil)

	// SEC-H1: Attacker in cluster-b cannot DELETE cluster-a's fault
	attackerTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "attacker",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"cluster-b": "ADMIN"},
	})
	delReq := httptest.NewRequest(http.MethodDelete, "/api/v1/chaos/inject", bytes.NewBufferString(`{"faultId":"`+faultID+`"}`))
	delReq.Header.Set("Authorization", "Bearer "+attackerTok)
	delReq.Header.Set("Content-Type", "application/json")
	delRec := httptest.NewRecorder()
	mux.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusForbidden {
		t.Fatalf("SEC-H1: expected 403 clearing another tenant's fault, got %d", delRec.Code)
	}

	// SEC-H1: GET /api/v1/chaos/faults without clusterId is rejected for user tokens
	listNoClusterReq := httptest.NewRequest(http.MethodGet, "/api/v1/chaos/faults", nil)
	listNoClusterReq.Header.Set("Authorization", "Bearer "+attackerTok)
	listNoClusterRec := httptest.NewRecorder()
	mux.ServeHTTP(listNoClusterRec, listNoClusterReq)
	if listNoClusterRec.Code != http.StatusBadRequest {
		t.Fatalf("SEC-H1: expected 400 on unscoped /api/v1/chaos/faults for user, got %d", listNoClusterRec.Code)
	}

	// GET /api/v1/chaos/faults?clusterId=cluster-a is forbidden for cluster-b user
	listOtherReq := httptest.NewRequest(http.MethodGet, "/api/v1/chaos/faults?clusterId=cluster-a", nil)
	listOtherReq.Header.Set("Authorization", "Bearer "+attackerTok)
	listOtherRec := httptest.NewRecorder()
	mux.ServeHTTP(listOtherRec, listOtherReq)
	if listOtherRec.Code != http.StatusForbidden {
		t.Fatalf("SEC-H1: expected 403 listing cluster-a faults as cluster-b user, got %d", listOtherRec.Code)
	}
}

func TestClusterAndRuleListings_FilterByAuthorizedTenant(t *testing.T) {
	const secret = "test-jwt-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	defer cm.ShutdownAll()

	cm.RegisterWithClientset("cluster-a", fake.NewSimpleClientset())
	cm.RegisterWithClientset("cluster-b", fake.NewSimpleClientset())

	eval := k8s.NewMetricEvaluator(cm, hub)
	eval.SetRules([]k8s.AlertRule{
		{RuleID: "r-a", ClusterID: "cluster-a", Name: "Rule A", Enabled: true},
		{RuleID: "r-b", ClusterID: "cluster-b", Name: "Rule B", Enabled: true},
		{RuleID: "r-global", ClusterID: "", Name: "Unscoped", Enabled: true},
	})

	mux := http.NewServeMux()
	SetupRoutes(mux, hub, cm, k8s.NewPodLogStreamer(hub), chaos.NewInjector(cm, hub), eval, nil)

	userATok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-a",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"cluster-a": "VIEWER"},
	})

	// SEC-H5: GET /api/v1/clusters only returns cluster-a
	cReq := httptest.NewRequest(http.MethodGet, "/api/v1/clusters", nil)
	cReq.Header.Set("Authorization", "Bearer "+userATok)
	cRec := httptest.NewRecorder()
	mux.ServeHTTP(cRec, cReq)
	if cRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on GET /api/v1/clusters, got %d", cRec.Code)
	}
	var cBody struct {
		Clusters map[string]bool `json:"clusters"`
		Total    int             `json:"total"`
	}
	if err := json.Unmarshal(cRec.Body.Bytes(), &cBody); err != nil {
		t.Fatalf("failed decoding clusters response: %v", err)
	}
	if cBody.Total != 1 || !cBody.Clusters["cluster-a"] || cBody.Clusters["cluster-b"] {
		t.Fatalf("SEC-H5: leaked unauthorized clusters: %+v", cBody)
	}

	// SEC-H5: GET /api/v1/evaluator/rules only returns cluster-a rule
	rReq := httptest.NewRequest(http.MethodGet, "/api/v1/evaluator/rules", nil)
	rReq.Header.Set("Authorization", "Bearer "+userATok)
	rRec := httptest.NewRecorder()
	mux.ServeHTTP(rRec, rReq)
	if rRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on GET /api/v1/evaluator/rules, got %d", rRec.Code)
	}
	var rBody struct {
		Rules []k8s.AlertRule `json:"rules"`
		Total int             `json:"total"`
	}
	if err := json.Unmarshal(rRec.Body.Bytes(), &rBody); err != nil {
		t.Fatalf("failed decoding rules response: %v", err)
	}
	if rBody.Total != 1 || len(rBody.Rules) != 1 || rBody.Rules[0].RuleID != "r-a" {
		t.Fatalf("SEC-H5: leaked unauthorized or unscoped rules: %+v", rBody)
	}
}
