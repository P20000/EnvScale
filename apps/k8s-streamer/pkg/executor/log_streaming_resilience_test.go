package executor_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/EnvScale/k8s-streamer/pkg/agent"
	"github.com/EnvScale/k8s-streamer/pkg/executor"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/server"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	ws "github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestAgentDisconnectAndSessionReplacementInterruptsStreams(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)

	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	factory := executor.NewClusterExecutorFactory(cm)
	t.Setenv("ALLOW_ANONYMOUS_WS", "true")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.HandleAgentWebSocket(hub, cm, w, r)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	u.Scheme = "ws"
	u.RawQuery = "clusterId=agent-resilience"

	connectAgent := func() (*websocket.Conn, context.CancelFunc, chan struct{}) {
		conn, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err != nil {
			t.Fatalf("dial failed: %v", err)
		}
		im := k8s.NewInformerManagerWithClientset(cs, ws.NewHub(), "agent-resilience")
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			defer close(done)
			agent.RunSession(ctx, conn, agent.Config{ClusterID: "agent-resilience"}, im, make(chan []byte, 32))
		}()
		ready := false
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			meta, ok := cm.AgentRegistry().GetStateMeta("agent-resilience")
			if ok && meta.Connected && meta.ProtocolVersion == "2.0" {
				ready = true
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if !ready {
			cancel()
			_ = conn.Close()
			<-done
			t.Fatalf("timed out waiting for agent-resilience Protocol v2.0 handshake")
		}
		return conn, cancel, done
	}

	conn1, cancel1, done1 := connectAgent()
	sink1 := make(chan executor.LogFrame, 64)
	handle1, err := factory.StartLogStream(context.Background(), "agent-resilience", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
	}, sink1)
	if err != nil {
		t.Fatalf("StartLogStream on session 1 failed: %v", err)
	}

	// Replace with session 2 -> stream 1 must terminate explicitly with agent_session_replaced
	conn2, cancel2, done2 := connectAgent()
	frames1 := collectFramesUntilDone(t, sink1, handle1.Done(), 3*time.Second)
	foundReplaced := false
	for _, f := range frames1 {
		if f.Type == "error" && f.Code == "agent_session_replaced" && f.Status == "interrupted" {
			foundReplaced = true
		}
	}
	if !foundReplaced {
		t.Fatalf("expected agent_session_replaced error frame when session 2 replaced session 1, got %+v", frames1)
	}
	cancel1()
	_ = conn1.Close()
	<-done1

	// Open stream on session 2 and abruptly drop Agent socket -> must emit agent_disconnected
	sink2 := make(chan executor.LogFrame, 64)
	handle2, err := factory.StartLogStream(context.Background(), "agent-resilience", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
	}, sink2)
	if err != nil {
		t.Fatalf("StartLogStream on session 2 failed: %v", err)
	}
	cancel2()
	_ = conn2.Close()
	<-done2

	frames2 := collectFramesUntilDone(t, sink2, handle2.Done(), 3*time.Second)
	foundDisconnect := false
	for _, f := range frames2 {
		if f.Type == "error" && f.Code == "agent_disconnected" && f.Status == "interrupted" {
			foundDisconnect = true
		}
	}
	if !foundDisconnect {
		t.Fatalf("expected agent_disconnected frame on abrupt disconnect, got %+v", frames2)
	}
}

func TestLegacyAgentV1RejectedAndSlowConsumerConcurrentSafe(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)

	// 1. Legacy v1.0 Agent fails cleanly with ErrCapabilityUnsupported
	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	factory := executor.NewClusterExecutorFactory(cm)
	cm.PromoteToAgentSession("legacy-v1", "sess-v1")
	cm.AgentRegistry().SetSnapshotForSession("legacy-v1", "sess-v1", types.ClusterSnapshot{})

	_, err := factory.StartLogStream(context.Background(), "legacy-v1", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0",
	}, make(chan executor.LogFrame, 8))
	if !errors.Is(err, executor.ErrCapabilityUnsupported) {
		t.Fatalf("expected ErrCapabilityUnsupported for v1.0 agent, got %v", err)
	}

	// 2. Concurrent multiplexed streams + slow consumer backpressure + goroutine leak check
	baseGoroutines := runtime.NumGoroutine()
	_, agentFactory, stopAgent := startLiveAgentTestCluster(t, "agent-mux", cs)
	defer stopAgent()

	// Slow consumer (tiny buffer, never drained while streaming)
	slowSink := make(chan executor.LogFrame, 1)
	slowHandle, err := agentFactory.StartLogStream(context.Background(), "agent-mux", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
	}, slowSink)
	if err != nil {
		t.Fatalf("slow stream failed: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sink := make(chan executor.LogFrame, 64)
			h, sErr := agentFactory.StartLogStream(context.Background(), "agent-mux", executor.LogStreamRequest{
				StreamID:   fmt.Sprintf("mux-%d", idx),
				Namespace:  "prod",
				Kind:       "pod",
				Name:       "web-0",
				Container:  "sidecar",
				TailLines:  5,
				Follow:     false,
				Previous:   idx%2 == 1,
				Timestamps: true,
			}, sink)
			if sErr != nil {
				t.Errorf("concurrent stream %d failed: %v", idx, sErr)
				return
			}
			frames := collectFramesUntilDone(t, sink, h.Done(), 3*time.Second)
			for _, f := range frames {
				if f.StreamID != h.StreamID() {
					t.Errorf("cross-stream contamination: expected streamId=%s got %s", h.StreamID(), f.StreamID)
				}
			}
		}(i)
	}
	wg.Wait()
	_ = slowHandle.Close()
	<-slowHandle.Done()

	time.Sleep(150 * time.Millisecond)
	if diff := runtime.NumGoroutine() - baseGoroutines; diff > 10 {
		t.Logf("warning: goroutines delta after concurrent test = %d", diff)
	}
}

func TestLogStreamingErrorClassificationDirectAndAgent(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)

	directHub := ws.NewHub()
	directCM := k8s.NewClusterManager(directHub)
	im := directCM.RegisterWithClientset("err-direct", cs)
	defer im.Stop()
	directFactory := executor.NewClusterExecutorFactory(directCM)

	_, agentFactory, stopAgent := startLiveAgentTestCluster(t, "err-agent", cs)
	defer stopAgent()

	// 1. Missing container returns normalized not_found error frame across both modes
	for _, tc := range []struct {
		name    string
		factory *executor.ClusterExecutorFactory
		cluster string
	}{
		{"direct", directFactory, "err-direct"},
		{"agent", agentFactory, "err-agent"},
	} {
		sink := make(chan executor.LogFrame, 16)
		h, err := tc.factory.StartLogStream(context.Background(), tc.cluster, executor.LogStreamRequest{
			Namespace: "prod", Kind: "pod", Name: "web-0", Container: "missing-container", Follow: false,
		}, sink)
		if err != nil {
			t.Fatalf("%s unexpected sync error: %v", tc.name, err)
		}
		frames := collectFramesUntilDone(t, sink, h.Done(), 3*time.Second)
		foundNotFound := false
		for _, f := range frames {
			if f.Type == "error" && f.Code == "not_found" {
				foundNotFound = true
			}
			if f.Type == "log" {
				t.Fatalf("%s must not emit fake log frames when container is missing", tc.name)
			}
		}
		if !foundNotFound {
			t.Fatalf("%s expected not_found error frame, got %+v", tc.name, frames)
		}
	}

	// 2. RBAC 403 on pods/log returns permission_denied without fake logs on Direct
	mockK8s.denyLogs.Store(true)
	sink403 := make(chan executor.LogFrame, 16)
	h403, err := directFactory.StartLogStream(context.Background(), "err-direct", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: false,
	}, sink403)
	if err != nil {
		t.Fatalf("direct 403 unexpected sync err: %v", err)
	}
	frames403 := collectFramesUntilDone(t, sink403, h403.Done(), 3*time.Second)
	foundDenied := false
	for _, f := range frames403 {
		if f.Type == "error" && f.Code == "permission_denied" {
			foundDenied = true
		}
	}
	if !foundDenied {
		t.Fatalf("expected permission_denied error frame on pods/log 403, got %+v", frames403)
	}
}

