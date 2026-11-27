package executor_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

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

type recordedLogReq struct {
	Namespace    string
	Pod          string
	Container    string
	TailLines    string
	Follow       string
	Previous     string
	Timestamps   string
	SinceSeconds string
}

type mockK8sLogServer struct {
	srv           *httptest.Server
	mu            sync.Mutex
	requests      []recordedLogReq
	denyLogs      atomic.Bool
	followCancelN atomic.Int32
	liveCh        chan string
}

func newMockK8sLogServer(t *testing.T) *mockK8sLogServer {
	t.Helper()
	m := &mockK8sLogServer{
		liveCh: make(chan string, 32),
	}

	pods := []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "web-0", Namespace: "prod"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "app"}, {Name: "sidecar"}},
			},
			Status: corev1.PodStatus{Phase: corev1.PodRunning},
		},
		{
			ObjectMeta: metav1.ObjectMeta{Name: "worker-1", Namespace: "staging"},
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Name: "worker"}},
			},
			Status: corev1.PodStatus{Phase: corev1.PodRunning},
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"APIVersions","versions":["v1"]}`))
	})
	mux.HandleFunc("/apis", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"APIGroupList","apiVersion":"v1","groups":[{"name":"apps","versions":[{"groupVersion":"apps/v1","version":"v1"}]},{"name":"authorization.k8s.io","versions":[{"groupVersion":"authorization.k8s.io/v1","version":"v1"}]}]}`))
	})
	mux.HandleFunc("/apis/authorization.k8s.io/v1/selfsubjectaccessreviews", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		allowed := true
		if m.denyLogs.Load() {
			if spec, ok := body["spec"].(map[string]any); ok {
				if ra, ok := spec["resourceAttributes"].(map[string]any); ok && ra["subresource"] == "log" {
					allowed = false
				}
			}
		}
		_, _ = fmt.Fprintf(w, `{"kind":"SelfSubjectAccessReview","apiVersion":"authorization.k8s.io/v1","status":{"allowed":%v}}`, allowed)
	})
	mux.HandleFunc("/api/v1/pods", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(corev1.PodList{TypeMeta: metav1.TypeMeta{Kind: "PodList", APIVersion: "v1"}, Items: pods})
	})
	mux.HandleFunc("/api/v1/namespaces/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/v1/namespaces/")
		parts := strings.Split(path, "/")
		if len(parts) == 2 && parts[1] == "pods" {
			ns := parts[0]
			var items []corev1.Pod
			for _, p := range pods {
				if p.Namespace == ns {
					items = append(items, p)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(corev1.PodList{TypeMeta: metav1.TypeMeta{Kind: "PodList", APIVersion: "v1"}, Items: items})
			return
		}
		if len(parts) == 3 && parts[1] == "pods" {
			ns, podName := parts[0], parts[2]
			for _, p := range pods {
				if p.Namespace == ns && p.Name == podName {
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(p)
					return
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}`))
			return
		}
		if len(parts) == 4 && parts[1] == "pods" && parts[3] == "log" {
			if m.denyLogs.Load() {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"Forbidden","message":"pods/log forbidden","code":403}`))
				return
			}
			q := r.URL.Query()
			rec := recordedLogReq{
				Namespace:    parts[0],
				Pod:          parts[2],
				Container:    q.Get("container"),
				TailLines:    q.Get("tailLines"),
				Follow:       q.Get("follow"),
				Previous:     q.Get("previous"),
				Timestamps:   q.Get("timestamps"),
				SinceSeconds: q.Get("sinceSeconds"),
			}
			m.mu.Lock()
			m.requests = append(m.requests, rec)
			m.mu.Unlock()

			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusOK)
			flusher, _ := w.(http.Flusher)

			if rec.Previous == "true" {
				_, _ = fmt.Fprintf(w, "2026-11-27T12:00:00Z WARN previous crash container=%s\n", rec.Container)
				if flusher != nil {
					flusher.Flush()
				}
				return
			}

			_, _ = fmt.Fprintf(w, "2026-11-27T12:01:00Z INFO startup ns=%s pod=%s container=%s\n", rec.Namespace, rec.Pod, rec.Container)
			_, _ = fmt.Fprintf(w, "2026-11-27T12:01:01Z ERROR simulated failure in %s\n", rec.Container)
			if flusher != nil {
				flusher.Flush()
			}

			if rec.Follow != "true" {
				return
			}

			for {
				select {
				case <-r.Context().Done():
					m.followCancelN.Add(1)
					return
				case line := <-m.liveCh:
					_, _ = fmt.Fprintf(w, "%s\n", line)
					if flusher != nil {
						flusher.Flush()
					}
				}
			}
		}
		http.NotFound(w, r)
	})

	m.srv = httptest.NewServer(mux)
	t.Cleanup(m.srv.Close)
	return m
}

func (m *mockK8sLogServer) clientset(t *testing.T) kubernetes.Interface {
	t.Helper()
	cs, err := kubernetes.NewForConfig(&rest.Config{
		Host:  m.srv.URL,
		QPS:   100,
		Burst: 200,
	})
	if err != nil {
		t.Fatalf("failed to build clientset: %v", err)
	}
	return cs
}

func (m *mockK8sLogServer) lastRequest() (recordedLogReq, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.requests) == 0 {
		return recordedLogReq{}, false
	}
	return m.requests[len(m.requests)-1], true
}

func startLiveAgentTestCluster(t *testing.T, clusterID string, cs kubernetes.Interface) (*k8s.ClusterManager, *executor.ClusterExecutorFactory, func()) {
	t.Helper()
	t.Setenv("ALLOW_ANONYMOUS_WS", "true")

	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	factory := executor.NewClusterExecutorFactory(cm)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.HandleAgentWebSocket(hub, cm, w, r)
	}))

	u, _ := url.Parse(srv.URL)
	u.Scheme = "ws"
	u.RawQuery = "clusterId=" + url.QueryEscape(clusterID)

	conn, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		srv.Close()
		t.Fatalf("failed to dial /ws/agent: %v", err)
	}

	im := k8s.NewInformerManagerWithClientset(cs, ws.NewHub(), clusterID)
	sessionCtx, cancel := context.WithCancel(context.Background())
	outCh := make(chan []byte, 64)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		agent.RunSession(sessionCtx, conn, agent.Config{ClusterID: clusterID}, im, outCh)
	}()

	ready := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		meta, ok := cm.AgentRegistry().GetStateMeta(clusterID)
		if ok && meta.Connected && meta.ProtocolVersion == "2.0" {
			ready = true
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if !ready {
		cancel()
		_ = conn.Close()
		wg.Wait()
		srv.Close()
		t.Fatalf("timed out waiting for agent %s Protocol v2.0 handshake", clusterID)
	}

	cleanup := func() {
		cancel()
		_ = conn.Close()
		wg.Wait()
		srv.Close()
	}
	return cm, factory, cleanup
}

func collectFramesUntilDone(t *testing.T, sink <-chan executor.LogFrame, done <-chan struct{}, timeout time.Duration) []executor.LogFrame {
	t.Helper()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	var frames []executor.LogFrame
	for {
		select {
		case f := <-sink:
			frames = append(frames, f)
		case <-done:
			for {
				select {
				case f := <-sink:
					frames = append(frames, f)
				default:
					return frames
				}
			}
		case <-timer.C:
			t.Fatalf("timed out waiting for stream completion; received %d frames", len(frames))
		}
	}
}

func TestDirectAndAgentLogStreamingParity(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)

	// Direct cluster
	directHub := ws.NewHub()
	directCM := k8s.NewClusterManager(directHub)
	im := directCM.RegisterWithClientset("direct-1", cs)
	defer im.Stop()
	directFactory := executor.NewClusterExecutorFactory(directCM)

	// Live Agent v2.0 cluster
	_, agentFactory, stopAgent := startLiveAgentTestCluster(t, "agent-1", cs)
	defer stopAgent()

	caps, err := agentFactory.Capabilities(context.Background(), "agent-1")
	if err != nil {
		t.Fatalf("unexpected error reading agent capabilities: %v", err)
	}
	if caps.Capabilities[executor.CapLogs].State != executor.CapSupportedWorking {
		t.Fatalf("expected agent v2.0 logs capability=supported_working, got %+v", caps.Capabilities[executor.CapLogs])
	}

	req := executor.LogStreamRequest{
		Namespace:  "prod",
		Kind:       "Pod",
		Name:       "web-0",
		Container:  "sidecar",
		TailLines:  25,
		Follow:     false,
		Previous:   false,
		Timestamps: true,
	}

	directSink := make(chan executor.LogFrame, 64)
	directHandle, err := directFactory.StartLogStream(context.Background(), "direct-1", req, directSink)
	if err != nil {
		t.Fatalf("Direct StartLogStream failed: %v", err)
	}
	directFrames := collectFramesUntilDone(t, directSink, directHandle.Done(), 3*time.Second)

	dReq, ok := mockK8s.lastRequest()
	if !ok || dReq.Container != "sidecar" || dReq.TailLines != "25" || dReq.Timestamps != "true" {
		t.Fatalf("unexpected Direct K8s log query params: %+v", dReq)
	}

	agentSink := make(chan executor.LogFrame, 64)
	agentHandle, err := agentFactory.StartLogStream(context.Background(), "agent-1", req, agentSink)
	if err != nil {
		t.Fatalf("Agent StartLogStream failed: %v", err)
	}
	agentFrames := collectFramesUntilDone(t, agentSink, agentHandle.Done(), 3*time.Second)

	aReq, ok := mockK8s.lastRequest()
	if !ok || aReq.Container != "sidecar" || aReq.TailLines != "25" || aReq.Timestamps != "true" {
		t.Fatalf("unexpected Agent K8s log query params: %+v", aReq)
	}

	extractLogs := func(in []executor.LogFrame) []executor.LogFrame {
		var out []executor.LogFrame
		for _, f := range in {
			if f.Type == "log" {
				out = append(out, f)
			}
		}
		return out
	}

	dLogs := extractLogs(directFrames)
	aLogs := extractLogs(agentFrames)
	if len(dLogs) != 2 || len(aLogs) != 2 {
		t.Fatalf("expected 2 normalized log frames from Direct (%d) and Agent (%d)", len(dLogs), len(aLogs))
	}
	for i := range dLogs {
		if dLogs[i].Namespace != aLogs[i].Namespace ||
			dLogs[i].Pod != aLogs[i].Pod ||
			dLogs[i].Container != aLogs[i].Container ||
			dLogs[i].Level != aLogs[i].Level ||
			dLogs[i].Message != aLogs[i].Message {
			t.Fatalf("Direct/Agent parity mismatch at %d:\nDirect=%+v\nAgent=%+v", i, dLogs[i], aLogs[i])
		}
	}
	if directFrames[len(directFrames)-1].Type != "end" || agentFrames[len(agentFrames)-1].Type != "end" {
		t.Fatalf("expected terminal 'end' frame on Direct and Agent follow=false streams")
	}
}

func TestAgentBidirectionalFollowAndCancellation(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)
	_, factory, stopAgent := startLiveAgentTestCluster(t, "agent-cancel", cs)
	defer stopAgent()

	sink := make(chan executor.LogFrame, 64)
	handle, err := factory.StartLogStream(context.Background(), "agent-cancel", executor.LogStreamRequest{
		Namespace:  "prod",
		Kind:       "pod",
		Name:       "web-0",
		Container:  "app",
		TailLines:  10,
		Follow:     true,
		Timestamps: true,
	}, sink)
	if err != nil {
		t.Fatalf("StartLogStream follow failed: %v", err)
	}

	// Wait for initial streamed log lines
	gotInitial := false
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		f := <-sink
		if f.Type == "log" {
			gotInitial = true
			break
		}
	}
	if !gotInitial {
		t.Fatalf("did not receive initial log frame over bidirectional Agent stream")
	}

	// Push live line after stream opened
	mockK8s.liveCh <- "2026-11-27T12:02:00Z INFO live line over agent"
	gotLive := false
	for time.Now().Before(time.Now().Add(2 * time.Second)) {
		select {
		case f := <-sink:
			if f.Type == "log" && strings.Contains(f.Message, "live line over agent") {
				gotLive = true
			}
		case <-time.After(1 * time.Second):
		}
		if gotLive {
			break
		}
	}
	if !gotLive {
		t.Fatalf("expected pushed live log line over active Agent WebSocket")
	}

	// Close handle from server side -> Agent receives LOG_STREAM_STOP and cancels K8s stream
	if err := handle.Close(); err != nil {
		t.Fatalf("handle.Close returned error: %v", err)
	}
	select {
	case <-handle.Done():
	case <-time.After(2 * time.Second):
		t.Fatalf("handle.Done did not close after handle.Close")
	}

	cancelDeadline := time.Now().Add(3 * time.Second)
	for mockK8s.followCancelN.Load() == 0 && time.Now().Before(cancelDeadline) {
		time.Sleep(15 * time.Millisecond)
	}
	if mockK8s.followCancelN.Load() == 0 {
		t.Fatalf("expected Server->Agent LOG_STREAM_STOP to cancel underlying K8s log HTTP request")
	}
}
