package server

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	gorillaws "github.com/gorilla/websocket"
	appsv1 "k8s.io/api/apps/v1"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/executor"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func setupDirectWithFakeSSAR(cm *k8s.ClusterManager, clusterID string, deniedResources map[string]bool) *k8s.InformerManager {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "web-1", Namespace: "default"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
	}
	client := fake.NewSimpleClientset(pod, dep)
	fakeDisc := client.Discovery().(*fakediscovery.FakeDiscovery)
	fakeDisc.Resources = []*metav1.APIResourceList{
		{GroupVersion: "v1"},
		{GroupVersion: "apps/v1"},
		{GroupVersion: "batch/v1"},
		{GroupVersion: "networking.k8s.io/v1"},
		{GroupVersion: "autoscaling/v2"},
		{GroupVersion: "policy/v1"},
		{GroupVersion: "rbac.authorization.k8s.io/v1"},
		{GroupVersion: "metrics.k8s.io/v1beta1"},
	}
	client.PrependReactor("create", "selfsubjectaccessreviews", func(action k8stesting.Action) (bool, runtime.Object, error) {
		sar := action.(k8stesting.CreateAction).GetObject().(*authorizationv1.SelfSubjectAccessReview).DeepCopy()
		ra := sar.Spec.ResourceAttributes
		allowed := true
		if ra != nil && deniedResources[ra.Group+"/"+ra.Resource] {
			allowed = false
		}
		sar.Status.Allowed = allowed
		return true, sar, nil
	})
	return cm.RegisterWithClientsetProbed(clusterID, client)
}

func TestExecutorRoutes_SnapshotAndCapabilitiesParityAndAuth(t *testing.T) {
	const secret = "executor-route-test-secret"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)

	inj := chaos.NewInjector(cm, hub)
	logStreamer := k8s.NewPodLogStreamer(hub)
	eval := k8s.NewMetricEvaluator(cm, hub)
	mux := http.NewServeMux()
	SetupRoutes(mux, hub, cm, logStreamer, inj, eval, nil)

	// Nodes denied (unavailable/null), services allowed & empty ([]), pods/deployments allowed & populated.
	directIM := setupDirectWithFakeSSAR(cm, "cluster-direct", map[string]bool{"/nodes": true})
	defer directIM.Stop()

	cm.AgentRegistry().RegisterSession("cluster-agent", "sess-a")
	cm.AgentRegistry().SetSnapshotForSession("cluster-agent", "sess-a", types.ClusterSnapshot{
		Pods:        []types.PodStatusDelta{{Name: "web-1", Namespace: "default", Phase: "Running"}},
		Services:    []types.ServiceStatusDelta{},
		Deployments: []types.DeploymentStatusDelta{{Name: "web", Namespace: "default"}},
		Nodes:       nil,
	})

	directViewerTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-direct-viewer",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"cluster-direct": "VIEWER"},
	})
	directMemberTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-direct-member",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"cluster-direct": "MEMBER"},
	})
	directAdminTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-direct-admin",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"cluster-direct": "ADMIN"},
	})
	agentAdminTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-agent-admin",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"cluster-agent": "ADMIN"},
	})
	serviceTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "api-server",
		"tokenType": "service",
	})
	agentMachineTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "agent-cluster-direct",
		"tokenType": "agent",
		"clusterId": "cluster-direct",
	})
	manifestTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "user-direct-viewer",
		"tokenType": "manifest_download",
		"clusterId": "cluster-direct",
	})
	wildcardTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":               "user-wild",
		"tokenType":         "user",
		"allowedClusterIds": []string{"*"},
	})
	missingTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-missing",
		"tokenType":    "user",
		"clusterRoles": map[string]string{"missing-cluster": "VIEWER"},
	})

	// 1. Authorization matrix across all 3 executor routes (Direct & Agent), plus HTTP Bearer-only enforcement.
	routes := []struct {
		url      string
		goodToks []string
		badTok   string
	}{
		{"/api/v1/clusters/snapshot?clusterId=cluster-direct", []string{directViewerTok, directMemberTok, directAdminTok, serviceTok}, agentAdminTok},
		{"/api/v1/clusters/snapshot?clusterId=cluster-agent", []string{agentAdminTok, serviceTok}, directViewerTok},
		{"/api/v1/clusters/cluster-direct/capabilities", []string{directViewerTok, directMemberTok, directAdminTok, serviceTok}, agentAdminTok},
		{"/api/v1/clusters/capabilities?clusterId=cluster-agent", []string{agentAdminTok, serviceTok}, directViewerTok},
		{"/api/v1/clusters/metrics/history?clusterId=cluster-direct", []string{directViewerTok, directMemberTok, directAdminTok, serviceTok}, agentAdminTok},
	}

	for _, rt := range routes {
		// Unauthenticated -> 401
		reqNoAuth := httptest.NewRequest(http.MethodGet, rt.url, nil)
		recNoAuth := httptest.NewRecorder()
		mux.ServeHTTP(recNoAuth, reqNoAuth)
		if recNoAuth.Code != http.StatusUnauthorized {
			t.Fatalf("%s without auth: expected 401, got %d", rt.url, recNoAuth.Code)
		}

		// ?token= query parameter MUST be rejected with 401 on HTTP executor routes (Condition 4).
		reqQueryTok := httptest.NewRequest(http.MethodGet, rt.url+"&token="+serviceTok, nil)
		if rt.url == "/api/v1/clusters/cluster-direct/capabilities" {
			reqQueryTok = httptest.NewRequest(http.MethodGet, rt.url+"?token="+serviceTok, nil)
		}
		recQueryTok := httptest.NewRecorder()
		mux.ServeHTTP(recQueryTok, reqQueryTok)
		if recQueryTok.Code != http.StatusUnauthorized {
			t.Fatalf("%s with ?token= query param: expected 401, got %d (%s)", rt.url, recQueryTok.Code, recQueryTok.Body.String())
		}

		// Cross-tenant token -> 403
		reqWrong := httptest.NewRequest(http.MethodGet, rt.url, nil)
		reqWrong.Header.Set("Authorization", "Bearer "+rt.badTok)
		recWrong := httptest.NewRecorder()
		mux.ServeHTTP(recWrong, reqWrong)
		if recWrong.Code != http.StatusForbidden {
			t.Fatalf("%s wrong tenant: expected 403, got %d", rt.url, recWrong.Code)
		}

		// Agent and manifest_download tokens -> 403
		for _, disallowed := range []string{agentMachineTok, manifestTok} {
			reqDis := httptest.NewRequest(http.MethodGet, rt.url, nil)
			reqDis.Header.Set("Authorization", "Bearer "+disallowed)
			recDis := httptest.NewRecorder()
			mux.ServeHTTP(recDis, reqDis)
			if recDis.Code != http.StatusForbidden {
				t.Fatalf("%s non-user token: expected 403, got %d", rt.url, recDis.Code)
			}
		}

		// Allowed roles -> 200
		for _, okTok := range rt.goodToks {
			reqOK := httptest.NewRequest(http.MethodGet, rt.url, nil)
			reqOK.Header.Set("Authorization", "Bearer "+okTok)
			recOK := httptest.NewRecorder()
			mux.ServeHTTP(recOK, reqOK)
			if recOK.Code != http.StatusOK {
				t.Fatalf("%s authorized: expected 200, got %d (%s)", rt.url, recOK.Code, recOK.Body.String())
			}
		}
	}

	// Non-user token without clusterId must still return 403 (not 400).
	for _, path := range []string{"/api/v1/clusters/snapshot", "/api/v1/clusters/capabilities"} {
		reqNoCidAgent := httptest.NewRequest(http.MethodGet, path, nil)
		reqNoCidAgent.Header.Set("Authorization", "Bearer "+agentMachineTok)
		recNoCidAgent := httptest.NewRecorder()
		mux.ServeHTTP(recNoCidAgent, reqNoCidAgent)
		if recNoCidAgent.Code != http.StatusForbidden {
			t.Fatalf("%s missing clusterId with agent token: expected 403, got %d", path, recNoCidAgent.Code)
		}
	}

	// Wildcard clusterId="*" with allowedClusterIds:["*"] -> 403
	reqWild := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/*/capabilities", nil)
	reqWild.Header.Set("Authorization", "Bearer "+wildcardTok)
	recWild := httptest.NewRecorder()
	mux.ServeHTTP(recWild, reqWild)
	if recWild.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for wildcard clusterId=*, got %d", recWild.Code)
	}

	// Browser WebSocket handshake helper MUST still accept ?token= query parameter (Condition 4).
	wsReq := httptest.NewRequest(http.MethodGet, "/ws/k8s?clusterId=cluster-direct&token="+directViewerTok, nil)
	if wsClaims, wsErr := websocket.AuthenticateHandshake(wsReq); wsErr != nil || wsClaims == nil {
		t.Fatalf("expected browser WS handshake to continue accepting ?token=, got err=%v", wsErr)
	}

	// 2. Normalized JSON snapshot field-by-field parity & empty [] vs unavailable null distinction.
	fetchRawJSON := func(clusterID, tok string) map[string]any {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+clusterID, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("snapshot %s returned %d: %s", clusterID, rec.Code, rec.Body.String())
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode JSON %s: %v", clusterID, err)
		}
		return out
	}

	directJSON := fetchRawJSON("cluster-direct", directViewerTok)
	agentJSON := fetchRawJSON("cluster-agent", agentAdminTok)

	// Identical key set across Direct and Agent.
	directKeys := make(map[string]bool)
	for k := range directJSON {
		directKeys[k] = true
	}
	agentKeys := make(map[string]bool)
	for k := range agentJSON {
		agentKeys[k] = true
	}
	if !reflect.DeepEqual(directKeys, agentKeys) {
		t.Fatalf("Direct and Agent SnapshotResponse JSON keys differ: direct=%v agent=%v", directKeys, agentKeys)
	}
	// Permitted empty services serialize as JSON [] (non-nil slice in map[string]any), denied nodes serialize as JSON null (nil).
	if directJSON["services"] == nil {
		t.Fatalf("expected permitted empty services on Direct to serialize as [], got null")
	}
	if directJSON["nodes"] != nil {
		t.Fatalf("expected denied nodes on Direct to serialize as null, got %#v", directJSON["nodes"])
	}
	if agentJSON["services"] == nil {
		t.Fatalf("expected populated empty services on Agent to serialize as [], got null")
	}
	if agentJSON["nodes"] != nil {
		t.Fatalf("expected unpopulated nodes on Agent to serialize as null, got %#v", agentJSON["nodes"])
	}

	// Agent v1 must NOT falsely claim events supported_working when incidents was nil.
	agentCapsMap := agentJSON["capabilities"].(map[string]any)["capabilities"].(map[string]any)
	if evState := agentCapsMap[executor.CapEvents].(map[string]any)["state"]; evState == string(executor.CapSupportedWorking) {
		t.Fatalf("Agent v1 must not report events=supported_working when incidents slice was nil")
	}

	// 3. Unregistered cluster returns 404 cluster_not_found.
	reqMissing := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/snapshot?clusterId=missing-cluster", nil)
	reqMissing.Header.Set("Authorization", "Bearer "+missingTok)
	recMissing := httptest.NewRecorder()
	mux.ServeHTTP(recMissing, reqMissing)
	if recMissing.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unregistered cluster, got %d (%s)", recMissing.Code, recMissing.Body.String())
	}
	var missingPayload map[string]string
	_ = json.Unmarshal(recMissing.Body.Bytes(), &missingPayload)
	if missingPayload["code"] != "cluster_not_found" {
		t.Fatalf("expected code=cluster_not_found, got %+v", missingPayload)
	}

	// 4. Agent disconnect -> reconnect -> fresh snapshot lifecycle (never serves old session data!).
	cm.AgentRegistry().MarkDisconnectedSession("cluster-agent", "sess-a")
	reqDisc := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/snapshot?clusterId=cluster-agent", nil)
	reqDisc.Header.Set("Authorization", "Bearer "+agentAdminTok)
	recDisc := httptest.NewRecorder()
	mux.ServeHTTP(recDisc, reqDisc)
	if recDisc.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for disconnected agent snapshot, got %d", recDisc.Code)
	}

	// New session sess-b connects; capabilities must report reconnecting and snapshot must return 503 (never stale web-1).
	cm.AgentRegistry().RegisterSession("cluster-agent", "sess-b")
	reqReconnCaps := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/cluster-agent/capabilities", nil)
	reqReconnCaps.Header.Set("Authorization", "Bearer "+agentAdminTok)
	recReconnCaps := httptest.NewRecorder()
	mux.ServeHTTP(recReconnCaps, reqReconnCaps)
	var reconnCaps executor.ClusterCapabilities
	_ = json.Unmarshal(recReconnCaps.Body.Bytes(), &reconnCaps)
	if reconnCaps.ConnectionState != executor.StateReconnecting {
		t.Fatalf("expected ConnectionState=reconnecting before fresh snapshot, got %q", reconnCaps.ConnectionState)
	}
	reqReconnSnap := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/snapshot?clusterId=cluster-agent", nil)
	reqReconnSnap.Header.Set("Authorization", "Bearer "+agentAdminTok)
	recReconnSnap := httptest.NewRecorder()
	mux.ServeHTTP(recReconnSnap, reqReconnSnap)
	if recReconnSnap.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 while reconnecting agent awaits fresh snapshot, got %d (%s)", recReconnSnap.Code, recReconnSnap.Body.String())
	}

	// Stale snapshot from sess-a must be rejected; sess-b snapshot restores connected state.
	if cm.AgentRegistry().SetSnapshotForSession("cluster-agent", "sess-a", types.ClusterSnapshot{Pods: []types.PodStatusDelta{{Name: "stale"}}}) {
		t.Fatalf("expected stale session sess-a snapshot update to be rejected")
	}
	cm.AgentRegistry().SetSnapshotForSession("cluster-agent", "sess-b", types.ClusterSnapshot{
		Pods: []types.PodStatusDelta{{Name: "fresh-pod", Namespace: "default", Phase: "Running"}},
	})
	freshJSON := fetchRawJSON("cluster-agent", agentAdminTok)
	podsArr := freshJSON["pods"].([]any)
	if len(podsArr) != 1 || podsArr[0].(map[string]any)["name"] != "fresh-pod" {
		t.Fatalf("expected fresh-pod from sess-b, got %+v", podsArr)
	}

	// 5. Deleting an Agent cluster via DELETE /api/v1/clusters must unregister it and evict executor/capabilities.
	reqDel := httptest.NewRequest(http.MethodDelete, "/api/v1/clusters?clusterId=cluster-agent", nil)
	reqDel.Header.Set("Authorization", "Bearer "+agentAdminTok)
	recDel := httptest.NewRecorder()
	mux.ServeHTTP(recDel, reqDel)
	if recDel.Code != http.StatusOK {
		t.Fatalf("expected 200 on DELETE /api/v1/clusters for agent cluster, got %d (%s)", recDel.Code, recDel.Body.String())
	}

	reqAfterDel := httptest.NewRequest(http.MethodGet, "/api/v1/clusters/cluster-agent/capabilities", nil)
	reqAfterDel.Header.Set("Authorization", "Bearer "+agentAdminTok)
	recAfterDel := httptest.NewRecorder()
	mux.ServeHTTP(recAfterDel, reqAfterDel)
	if recAfterDel.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after agent cluster deletion, got %d (%s)", recAfterDel.Code, recAfterDel.Body.String())
	}
}

func startMockK8sAPIServerForLifecycle(t *testing.T, expectedToken, podName string) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+expectedToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/version":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"major":      "1",
				"minor":      "30",
				"gitVersion": "v1.30.0",
			})
		case "/api":
			_ = json.NewEncoder(w).Encode(metav1.APIVersions{Versions: []string{"v1"}})
		case "/apis":
			_ = json.NewEncoder(w).Encode(metav1.APIGroupList{
				Groups: []metav1.APIGroup{
					{Name: "apps", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "apps/v1", Version: "v1"}}},
					{Name: "authorization.k8s.io", Versions: []metav1.GroupVersionForDiscovery{{GroupVersion: "authorization.k8s.io/v1", Version: "v1"}}},
				},
			})
		case "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews":
			var sar authorizationv1.SelfSubjectAccessReview
			_ = json.NewDecoder(r.Body).Decode(&sar)
			sar.Status.Allowed = true
			_ = json.NewEncoder(w).Encode(sar)
		default:
			if r.URL.Query().Get("watch") == "true" {
				w.WriteHeader(http.StatusOK)
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
				<-r.Context().Done()
				return
			}
			if r.URL.Path == "/api/v1/pods" {
				_ = json.NewEncoder(w).Encode(corev1.PodList{
					TypeMeta: metav1.TypeMeta{APIVersion: "v1", Kind: "PodList"},
					ListMeta: metav1.ListMeta{ResourceVersion: "1"},
					Items: []corev1.Pod{{
						ObjectMeta: metav1.ObjectMeta{Name: podName, Namespace: "default"},
						Status:     corev1.PodStatus{Phase: corev1.PodRunning},
					}},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"apiVersion": "v1",
				"kind":       "List",
				"metadata":   map[string]string{"resourceVersion": "1"},
				"items":      []any{},
			})
		}
	}))
}

func buildInlineKubeconfig(srv *httptest.Server, token string) string {
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	caB64 := base64.StdEncoding.EncodeToString(pemBytes)
	return fmt.Sprintf(`apiVersion: v1
kind: Config
clusters:
- name: mock
  cluster:
    certificate-authority-data: %s
    server: %s
contexts:
- name: mock
  context:
    cluster: mock
    user: mock-user
current-context: mock
users:
- name: mock-user
  user:
    token: %s
`, caB64, srv.URL, token)
}

func TestExecutorRoutes_FullClusterLifecycleEndToEnd(t *testing.T) {
	const secret = "full-lifecycle-secret"
	const cid = "11111111-2222-3333-4444-555555555555"
	t.Setenv("JWT_ACCESS_SECRET", secret)
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	k8sSrv1 := startMockK8sAPIServerForLifecycle(t, "k8s-cred-1", "pod-v1")
	defer k8sSrv1.Close()
	k8sSrv2 := startMockK8sAPIServerForLifecycle(t, "k8s-cred-2", "pod-v2")
	defer k8sSrv2.Close()

	hub := websocket.NewHub()
	cm := k8s.NewClusterManager(hub)
	defer cm.ShutdownAll()

	mux := http.NewServeMux()
	SetupRoutes(mux, hub, cm, k8s.NewPodLogStreamer(hub), chaos.NewInjector(cm, hub), k8s.NewMetricEvaluator(cm, hub), nil)
	gwSrv := httptest.NewServer(mux)
	defer gwSrv.Close()

	svcTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "api-server",
		"role":      "SERVICE",
		"tokenType": "service",
	})
	adminTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":          "user-admin",
		"tokenType":    "user",
		"clusterRoles": map[string]string{cid: "ADMIN"},
	})
	agentTok := signTestJWT(t, secret, jwt.MapClaims{
		"sub":       "agent-" + cid,
		"tokenType": "agent",
		"clusterId": cid,
	})

	doReq := func(method, path, tok string, body any) (*http.Response, []byte) {
		t.Helper()
		var reader *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			reader = bytes.NewReader(b)
		} else {
			reader = bytes.NewReader(nil)
		}
		req, _ := http.NewRequest(method, gwSrv.URL+path, reader)
		req.Header.Set("Authorization", "Bearer "+tok)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := gwSrv.Client().Do(req)
		if err != nil {
			t.Fatalf("%s %s failed: %v", method, path, err)
		}
		defer resp.Body.Close()
		var buf bytes.Buffer
		_, _ = buf.ReadFrom(resp.Body)
		return resp, buf.Bytes()
	}

	// Step 1: Register Direct cluster (cred-1 -> pod-v1) via HTTP route.
	regResp1, regBody1 := doReq(http.MethodPost, "/api/v1/clusters/register", svcTok, RegisterClusterRequest{
		ClusterID:  cid,
		Kubeconfig: base64.StdEncoding.EncodeToString([]byte(buildInlineKubeconfig(k8sSrv1, "k8s-cred-1"))),
	})
	if regResp1.StatusCode != http.StatusOK {
		t.Fatalf("Step 1 register Direct failed (%d): %s", regResp1.StatusCode, string(regBody1))
	}
	im1, ok := cm.GetCluster(cid)
	if !ok || im1 == nil {
		t.Fatalf("Step 1 expected Direct InformerManager registered")
	}

	// Step 2: Retrieve snapshot -> Direct mode, pod-v1.
	deadline := time.Now().Add(3 * time.Second)
	for {
		resp, body := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
		if resp.StatusCode == http.StatusOK {
			var snap executor.SnapshotResponse
			_ = json.Unmarshal(body, &snap)
			if snap.ConnectionMode == executor.ModeDirect && len(snap.Pods) == 1 && snap.Pods[0].Name == "pod-v1" {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("Step 2 timed out waiting for Direct snapshot with pod-v1")
		}
		time.Sleep(25 * time.Millisecond)
	}

	// Step 3: Re-register with changed credentials (cred-2 -> pod-v2).
	regResp2, regBody2 := doReq(http.MethodPost, "/api/v1/clusters/register", svcTok, RegisterClusterRequest{
		ClusterID:  cid,
		Kubeconfig: base64.StdEncoding.EncodeToString([]byte(buildInlineKubeconfig(k8sSrv2, "k8s-cred-2"))),
	})
	if regResp2.StatusCode != http.StatusOK {
		t.Fatalf("Step 3 re-register Direct failed (%d): %s", regResp2.StatusCode, string(regBody2))
	}

	// Step 4: Verify old Direct InformerManager/executor invalidated and new snapshot serves pod-v2.
	if im1.IsRunning() {
		t.Fatalf("Step 4 expected old InformerManager im1 to be stopped after credential replacement")
	}
	im2, ok := cm.GetCluster(cid)
	if !ok || im2 == im1 {
		t.Fatalf("Step 4 expected fresh InformerManager im2 after re-registration")
	}
	deadline = time.Now().Add(3 * time.Second)
	for {
		resp, body := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
		if resp.StatusCode == http.StatusOK {
			var snap executor.SnapshotResponse
			_ = json.Unmarshal(body, &snap)
			if snap.ConnectionMode == executor.ModeDirect && len(snap.Pods) == 1 && snap.Pods[0].Name == "pod-v2" {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("Step 4 timed out waiting for pod-v2 after credential replacement")
		}
		time.Sleep(25 * time.Millisecond)
	}

	// Step 5: Switch connection mode to Agent over live /ws/agent WebSocket + send initial snapshot.
	wsURL := "ws" + strings.TrimPrefix(gwSrv.URL, "http") + "/ws/agent?clusterId=" + cid
	wsHeaders := http.Header{"Authorization": []string{"Bearer " + agentTok}}
	conn1, _, err := gorillaws.DefaultDialer.Dial(wsURL, wsHeaders)
	if err != nil {
		t.Fatalf("Step 5 agent WS dial failed: %v", err)
	}
	syncMsg1, _ := json.Marshal(types.WSEventEnvelope{
		Event:     types.EventSnapshotSync,
		ClusterID: cid,
		Data: types.ClusterSnapshot{
			Pods: []types.PodStatusDelta{{Name: "agent-pod-1", Namespace: "default", Phase: "Running"}},
		},
	})
	if err := conn1.WriteMessage(gorillaws.TextMessage, syncMsg1); err != nil {
		t.Fatalf("Step 5 write snapshot sync failed: %v", err)
	}

	// Step 6: Verify Direct InformerManager stopped/removed and snapshot serves Agent mode agent-pod-1.
	if _, stillDirect := cm.GetCluster(cid); stillDirect {
		t.Fatalf("Step 6 expected Direct cluster to be removed when promoted to Agent mode")
	}
	if im2.IsRunning() {
		t.Fatalf("Step 6 expected previous Direct InformerManager im2 stopped on mode transition")
	}
	deadline = time.Now().Add(2 * time.Second)
	for {
		resp, body := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
		if resp.StatusCode == http.StatusOK {
			var snap executor.SnapshotResponse
			_ = json.Unmarshal(body, &snap)
			if snap.ConnectionMode == executor.ModeAgent && len(snap.Pods) == 1 && snap.Pods[0].Name == "agent-pod-1" {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("Step 6 timed out waiting for Agent mode snapshot agent-pod-1")
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Step 7: Disconnect Agent WebSocket -> disconnected capabilities and 503 snapshot.
	_ = conn1.Close()
	deadline = time.Now().Add(2 * time.Second)
	for {
		_, cBody := doReq(http.MethodGet, "/api/v1/clusters/"+cid+"/capabilities", adminTok, nil)
		var caps executor.ClusterCapabilities
		_ = json.Unmarshal(cBody, &caps)
		if caps.ConnectionState == executor.StateDisconnected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Step 7 timed out waiting for disconnected state, got %q", caps.ConnectionState)
		}
		time.Sleep(15 * time.Millisecond)
	}
	discResp, discBody := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
	if discResp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("Step 7 expected 503 after Agent disconnect, got %d (%s)", discResp.StatusCode, string(discBody))
	}

	// Step 8 & 9: Reconnect new Agent session (conn2) WITHOUT sending snapshot -> reconnecting + 503 (never agent-pod-1).
	conn2, _, err := gorillaws.DefaultDialer.Dial(wsURL, wsHeaders)
	if err != nil {
		t.Fatalf("Step 8 reconnect agent WS dial failed: %v", err)
	}
	defer conn2.Close()

	_, rcBody := doReq(http.MethodGet, "/api/v1/clusters/"+cid+"/capabilities", adminTok, nil)
	var rcCaps executor.ClusterCapabilities
	_ = json.Unmarshal(rcBody, &rcCaps)
	if rcCaps.ConnectionState != executor.StateReconnecting {
		t.Fatalf("Step 9 expected ConnectionState=reconnecting, got %q", rcCaps.ConnectionState)
	}
	rcSnapResp, _ := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
	if rcSnapResp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("Step 9 expected 503 before fresh snapshot on reconnected session, got %d", rcSnapResp.StatusCode)
	}

	// Send fresh snapshot on new session -> connected + agent-pod-2.
	syncMsg2, _ := json.Marshal(types.WSEventEnvelope{
		Event:     types.EventSnapshotSync,
		ClusterID: cid,
		Data: types.ClusterSnapshot{
			Pods: []types.PodStatusDelta{{Name: "agent-pod-2", Namespace: "default", Phase: "Running"}},
		},
	})
	if err := conn2.WriteMessage(gorillaws.TextMessage, syncMsg2); err != nil {
		t.Fatalf("Step 9 write fresh snapshot failed: %v", err)
	}
	deadline = time.Now().Add(2 * time.Second)
	for {
		resp, body := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
		if resp.StatusCode == http.StatusOK {
			var snap executor.SnapshotResponse
			_ = json.Unmarshal(body, &snap)
			if snap.ConnectionState == executor.StateConnected && len(snap.Pods) == 1 && snap.Pods[0].Name == "agent-pod-2" {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("Step 9 timed out waiting for fresh agent-pod-2 snapshot")
		}
		time.Sleep(15 * time.Millisecond)
	}

	// Step 10: Delete cluster -> 200 and complete removal of Direct, Agent, Executor, and Capabilities state.
	delResp, delBody := doReq(http.MethodDelete, "/api/v1/clusters?clusterId="+cid, adminTok, nil)
	if delResp.StatusCode != http.StatusOK {
		t.Fatalf("Step 10 delete cluster failed (%d): %s", delResp.StatusCode, string(delBody))
	}
	if _, hasDirect := cm.GetCluster(cid); hasDirect {
		t.Fatalf("Step 10 expected Direct registry cleared on delete")
	}
	if cm.AgentRegistry().HasCluster(cid) {
		t.Fatalf("Step 10 expected Agent registry cleared on delete")
	}
	afterSnap, _ := doReq(http.MethodGet, "/api/v1/clusters/snapshot?clusterId="+cid, adminTok, nil)
	afterCaps, _ := doReq(http.MethodGet, "/api/v1/clusters/"+cid+"/capabilities", adminTok, nil)
	if afterSnap.StatusCode != http.StatusNotFound || afterCaps.StatusCode != http.StatusNotFound {
		t.Fatalf("Step 10 expected 404 on snapshot/capabilities after delete, got %d / %d", afterSnap.StatusCode, afterCaps.StatusCode)
	}
}
