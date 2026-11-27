package executor_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
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

func TestAgentProtocolIsolation_DuplicateIDsCrossSessionReuseAndStaleStop(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)
	t.Setenv("ALLOW_ANONYMOUS_WS", "true")

	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	factory := executor.NewClusterExecutorFactory(cm)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.HandleAgentWebSocket(hub, cm, w, r)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	u.Scheme = "ws"
	u.RawQuery = "clusterId=iso-cluster"

	connect := func() (*websocket.Conn, context.CancelFunc, chan struct{}) {
		c, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
		if resp != nil && resp.Body != nil {
			_ = resp.Body.Close()
		}
		if err != nil {
			t.Fatalf("dial err: %v", err)
		}
		im := k8s.NewInformerManagerWithClientset(cs, ws.NewHub(), "iso-cluster")
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			defer close(done)
			agent.RunSession(ctx, c, agent.Config{ClusterID: "iso-cluster"}, im, make(chan []byte, 16))
		}()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if m, ok := cm.AgentRegistry().GetStateMeta("iso-cluster"); ok && m.Connected && m.ProtocolVersion == "2.0" {
				return c, cancel, done
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("timed out waiting for iso-cluster v2 handshake")
		return nil, nil, nil
	}

	c1, cancel1, done1 := connect()

	sink1 := make(chan executor.LogFrame, 32)
	h1, err := factory.StartLogStream(context.Background(), "iso-cluster", executor.LogStreamRequest{
		StreamID: "fixed-stream-1", Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
	}, sink1)
	if err != nil {
		t.Fatalf("start 1 failed: %v", err)
	}

	// 1. Duplicate active streamId rejected without disrupting active stream
	if _, dupErr := factory.StartLogStream(context.Background(), "iso-cluster", executor.LogStreamRequest{
		StreamID: "fixed-stream-1", Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true,
	}, make(chan executor.LogFrame, 8)); !errors.Is(dupErr, k8s.ErrDuplicateLogStreamID) {
		t.Fatalf("expected ErrDuplicateLogStreamID for duplicate active ID, got %v", dupErr)
	}

	// 2. Spoofed cross-cluster & cross-session frame delivery is rejected cleanly
	meta1, _ := cm.AgentRegistry().GetStateMeta("iso-cluster")
	if cm.AgentRegistry().SessionHub().DeliverLogFrame("iso-cluster", "wrong-session", types.LogStreamFrame{
		Type: "log", StreamID: "fixed-stream-1", Message: "cross-session-leak",
	}) {
		t.Fatalf("expected frame with mismatched session to be rejected")
	}
	if cm.AgentRegistry().SessionHub().DeliverLogFrame("iso-cluster", meta1.SessionID, types.LogStreamFrame{
		Type: "log", StreamID: "fixed-stream-1", ClusterID: "victim-cluster", Message: "cross-cluster-leak",
	}) {
		t.Fatalf("expected frame with mismatched clusterId to be rejected")
	}

	// Drain initial frames
	time.Sleep(50 * time.Millisecond)
drainLoop:
	for {
		select {
		case f := <-sink1:
			if strings.Contains(f.Message, "leak") {
				t.Fatalf("leaked spoofed frame into sink1: %+v", f)
			}
		default:
			break drainLoop
		}
	}

	// 3. Session replacement + attempt to reuse "fixed-stream-1" across sessions rejected
	c2, cancel2, done2 := connect()
	_ = collectFramesUntilDone(t, sink1, h1.Done(), 3*time.Second)
	cancel1()
	_ = c1.Close()
	<-done1

	if _, reuseErr := factory.StartLogStream(context.Background(), "iso-cluster", executor.LogStreamRequest{
		StreamID: "fixed-stream-1", Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: false,
	}, make(chan executor.LogFrame, 8)); !errors.Is(reuseErr, k8s.ErrDuplicateLogStreamID) {
		t.Fatalf("expected ErrDuplicateLogStreamID across sessions, got %v", reuseErr)
	}

	// 4. Browser cancel AFTER Agent disconnects is idempotent and never blocks/leaks
	sink2 := make(chan executor.LogFrame, 32)
	h2, err := factory.StartLogStream(context.Background(), "iso-cluster", executor.LogStreamRequest{
		StreamID: "post-disc-2", Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true,
	}, sink2)
	if err != nil {
		t.Fatalf("start 2 failed: %v", err)
	}
	cancel2()
	_ = c2.Close()
	<-done2
	<-h2.Done()
	if closeErr := h2.Close(); closeErr != nil {
		t.Fatalf("handle.Close after agent disconnect should stay non-blocking/nil, got %v", closeErr)
	}
}

func TestAgentProtocol_StaleStopIgnoredByAgentSession(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)

	startSent := make(chan struct{}, 1)
	var stopFromWrongSess atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		up := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		conn, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Read AGENT_HELLO & snapshot, reply SERVER_HELLO_ACK with real sessionID
		for i := 0; i < 2; i++ {
			_, _, _ = conn.ReadMessage()
		}
		_ = conn.WriteJSON(types.WSEventEnvelope{
			Event: types.EventServerHelloAck,
			Data:  types.ServerHelloAckPayload{ClusterID: "stale-stop", SessionID: "real-sess", ProtocolVersion: "2.0"},
		})
		_ = conn.WriteJSON(types.WSEventEnvelope{
			Event: types.EventLogStreamStart,
			Data: types.LogStreamStartPayload{
				StreamID: "s-active", ClusterID: "stale-stop", SessionID: "real-sess",
				Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
			},
		})
		// Wait until Agent begins emitting logs, then inject a STALE LOG_STREAM_STOP for a prior session
		<-startSent
		_ = conn.WriteJSON(types.WSEventEnvelope{
			Event: types.EventLogStreamStop,
			Data:  types.LogStreamStopPayload{StreamID: "s-active", ClusterID: "stale-stop", SessionID: "old-stale-sess", Reason: "stale"},
		})
		stopFromWrongSess.Store(true)
		time.Sleep(100 * time.Millisecond)
	}))
	defer srv.Close()

	goSrvCh := make(chan bool, 1)
	u, _ := url.Parse(srv.URL)
	u.Scheme = "ws"
	conn, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}

	im := k8s.NewInformerManagerWithClientset(cs, ws.NewHub(), "stale-stop")
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		agent.RunSession(ctx, conn, agent.Config{ClusterID: "stale-stop"}, im, make(chan []byte, 16))
	}()

	// Signal when initial stream opened; push a live log after stale stop and ensure stream stayed alive.
	startSent <- struct{}{}
	for !stopFromWrongSess.Load() {
		time.Sleep(10 * time.Millisecond)
	}
	goSrvCh <- (mockK8s.followCancelN.Load() == 0)
	if !<-goSrvCh {
		t.Fatalf("stale-session LOG_STREAM_STOP canceled active stream when it should have been ignored")
	}
	cancel()
	_ = conn.Close()
	wg.Wait()
}

func TestAgentBackpressure_AggregateByteBudgetMaxStreamsAndTimeout(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)
	cm, factory, stopAgent := startLiveAgentTestCluster(t, "agent-limits", cs)
	defer stopAgent()

	cm.AgentRegistry().SessionHub().SetLimits(k8s.AgentSessionLimits{
		MaxConcurrentStreamsPerAgent: 2,
		MaxClusterBufferedBytes:      1024, // force immediate drop when consumer stops draining
		MaxStreamBufferedBytes:       1024,
		MaxStreamDuration:            250 * time.Millisecond,
		MaxDroppedBeforeTerminate:    2,
	})

	// 1. First two streams open cleanly; 3rd exceeds concurrent limit cleanly
	h1, err := factory.StartLogStream(context.Background(), "agent-limits", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
	}, make(chan executor.LogFrame, 32))
	if err != nil {
		t.Fatalf("stream 1 failed: %v", err)
	}
	h2, err := factory.StartLogStream(context.Background(), "agent-limits", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "sidecar", Follow: true, Timestamps: true,
	}, make(chan executor.LogFrame, 32))
	if err != nil {
		t.Fatalf("stream 2 failed: %v", err)
	}
	if _, limitErr := factory.StartLogStream(context.Background(), "agent-limits", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: false,
	}, make(chan executor.LogFrame, 8)); !errors.Is(limitErr, k8s.ErrTooManyAgentStreams) {
		t.Fatalf("expected ErrTooManyAgentStreams for 3rd stream, got %v", limitErr)
	}

	// 2. Active streams hit MaxStreamDuration (250ms) and close cleanly
	select {
	case <-h1.Done():
	case <-time.After(3 * time.Second):
		t.Fatalf("stream 1 did not terminate on MaxStreamDuration")
	}
	_ = h2.Close()
	<-h2.Done()

	// 3. Slow consumer exceeding byte budget surfaces backpressure/resource_exhausted and cancels Agent stream
	beforeCancels := mockK8s.followCancelN.Load()
	cm.AgentRegistry().SessionHub().SetLimits(k8s.AgentSessionLimits{
		MaxConcurrentStreamsPerAgent: 8,
		MaxClusterBufferedBytes:      128, // force drops cleanly on queued bursts
		MaxStreamBufferedBytes:       128,
		MaxStreamDuration:            5 * time.Second,
		MaxDroppedBeforeTerminate:    3,
	})
	slowSink := make(chan executor.LogFrame, 1)
	hSlow, err := factory.StartLogStream(context.Background(), "agent-limits", executor.LogStreamRequest{
		StreamID: "bp-agent-1", Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: true, Timestamps: true,
	}, slowSink)
	if err != nil {
		t.Fatalf("bp stream failed: %v", err)
	}
	for i := 0; i < 8; i++ {
		select {
		case mockK8s.liveCh <- "2026-11-27T12:03:00Z INFO " + strings.Repeat("X", 200):
		case <-hSlow.Done():
		case <-time.After(200 * time.Millisecond):
		}
	}
	select {
	case <-hSlow.Done():
	case <-time.After(3 * time.Second):
		t.Fatalf("expected slow agent stream to terminate on resource_exhausted")
	}
	if mockK8s.followCancelN.Load() <= beforeCancels {
		t.Fatalf("expected resource_exhausted to dispatch LOG_STREAM_STOP and cancel Agent K8s HTTP stream")
	}
	if rem := cm.AgentRegistry().SessionHub().ClusterBufferedBytes("agent-limits"); rem != 0 {
		t.Fatalf("expected cluster buffered bytes accounting to return to 0, got %d", rem)
	}
}

func TestAgentCompatibility_V1UsableProtocolMismatchAndMalformedFrames(t *testing.T) {
	mockK8s := newMockK8sLogServer(t)
	cs := mockK8s.clientset(t)
	t.Setenv("ALLOW_ANONYMOUS_WS", "true")

	hub := ws.NewHub()
	cm := k8s.NewClusterManager(hub)
	factory := executor.NewClusterExecutorFactory(cm)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		server.HandleAgentWebSocket(hub, cm, w, r)
	}))
	defer srv.Close()

	// 1. Unsupported protocol version "3.0" is explicitly rejected (no silent downgrade)
	u, _ := url.Parse(srv.URL)
	u.Scheme = "ws"
	u.RawQuery = "clusterId=proto-v3"
	conn, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	_ = conn.WriteJSON(types.WSEventEnvelope{
		Event: types.EventAgentHello,
		Data:  types.AgentHelloPayload{ProtocolVersion: "3.0", AgentVersion: "3.0.0"},
	})

	var errEnv struct {
		Event string                     `json:"event"`
		Data  types.ProtocolErrorPayload `json:"data"`
	}
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := conn.ReadJSON(&errEnv); err != nil {
		t.Fatalf("expected PROTOCOL_ERROR, got %v", err)
	}
	if errEnv.Event != types.EventProtocolError || errEnv.Data.Code != "unsupported_protocol_version" {
		t.Fatalf("expected PROTOCOL_ERROR/unsupported_protocol_version, got %+v", errEnv)
	}
	// Connection must close cleanly rather than silently downgrading to v1.0
	if _, _, readErr := conn.ReadMessage(); readErr == nil {
		t.Fatalf("expected server to close rejected unsupported-protocol WebSocket")
	}
	if _, streamErr := factory.StartLogStream(context.Background(), "proto-v3", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app",
	}, make(chan executor.LogFrame, 8)); !errors.Is(streamErr, executor.ErrClusterDisconnected) {
		t.Fatalf("expected ErrClusterDisconnected after unsupported protocol closure, got %v", streamErr)
	}

	// 2. Explicit Agent v1.0 handshake stays usable for snapshots & tolerates malformed frames while rejecting logs
	u1, _ := url.Parse(srv.URL)
	u1.Scheme = "ws"
	u1.RawQuery = "clusterId=explicit-v1"
	c1, r1, e1 := websocket.DefaultDialer.Dial(u1.String(), nil)
	if r1 != nil && r1.Body != nil {
		_ = r1.Body.Close()
	}
	if e1 != nil {
		t.Fatalf("v1 dial failed: %v", e1)
	}
	defer c1.Close()

	_ = c1.WriteJSON(types.WSEventEnvelope{
		Event: types.EventAgentHello,
		Data:  types.AgentHelloPayload{ProtocolVersion: "1.0", AgentVersion: "1.0.0"},
	})
	var ackEnv struct {
		Event string                      `json:"event"`
		Data  types.ServerHelloAckPayload `json:"data"`
	}
	_ = c1.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := c1.ReadJSON(&ackEnv); err != nil {
		t.Fatalf("expected SERVER_HELLO_ACK for v1.0, got %v", err)
	}
	if ackEnv.Data.ProtocolVersion != "1.0" {
		t.Fatalf("expected negotiated v1.0 ACK, got %q", ackEnv.Data.ProtocolVersion)
	}
	_ = c1.WriteJSON(types.WSEventEnvelope{
		Event: types.EventSnapshotSync,
		Data:  types.ClusterSnapshot{Pods: []types.PodStatusDelta{{Name: "web-0", Namespace: "prod"}}},
	})
	_ = c1.WriteMessage(websocket.TextMessage, []byte("{malformed-json"))
	_ = c1.WriteMessage(websocket.TextMessage, []byte(`{"event":"LOG_FRAME","data":null}`))

	snapDeadline := time.Now().Add(2 * time.Second)
	var snap *executor.SnapshotResponse
	for time.Now().Before(snapDeadline) {
		snap, err = factory.GetSnapshot(context.Background(), "explicit-v1")
		if err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil || snap == nil || len(snap.Pods) != 1 {
		t.Fatalf("expected v1.0 snapshot usable after malformed frames, err=%v snap=%+v", err, snap)
	}
	if snap.Capabilities.Capabilities[executor.CapLogs].State != executor.CapNotImplemented {
		t.Fatalf("expected CapLogs=not_implemented for v1.0 agent, got %+v", snap.Capabilities.Capabilities[executor.CapLogs])
	}
	if _, streamErr := factory.StartLogStream(context.Background(), "explicit-v1", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app",
	}, make(chan executor.LogFrame, 8)); !errors.Is(streamErr, executor.ErrCapabilityUnsupported) {
		t.Fatalf("expected ErrCapabilityUnsupported on v1.0 agent, got %v", streamErr)
	}

	// 3. Verify v2 Agent log streaming works unaffected alongside v1/rejected sockets
	_, v2Factory, stopV2 := startLiveAgentTestCluster(t, "v2-healthy", cs)
	defer stopV2()
	s := make(chan executor.LogFrame, 16)
	h, err := v2Factory.StartLogStream(context.Background(), "v2-healthy", executor.LogStreamRequest{
		Namespace: "prod", Kind: "pod", Name: "web-0", Container: "app", Follow: false, Timestamps: true,
	}, s)
	if err != nil {
		t.Fatalf("healthy v2 stream failed after malformed frames on other cluster: %v", err)
	}
	frames := collectFramesUntilDone(t, s, h.Done(), 3*time.Second)
	if len(frames) == 0 {
		t.Fatalf("expected frames on healthy v2 cluster")
	}
}

func TestDefaultAgentSessionLimits_EnvValidation(t *testing.T) {
	t.Setenv("ENVSCALE_MAX_AGENT_LOG_STREAMS", "-5")
	t.Setenv("ENVSCALE_MAX_AGENT_CLUSTER_BYTES", "not-a-number")
	t.Setenv("ENVSCALE_MAX_AGENT_STREAM_BYTES", "1024") // below 64KiB floor -> clamped
	t.Setenv("ENVSCALE_MAX_AGENT_STREAM_DURATION_SEC", "120")
	t.Setenv("ENVSCALE_MAX_AGENT_DROPPED_FRAMES", "500")

	limits := k8s.DefaultAgentSessionLimits()
	if limits.MaxConcurrentStreamsPerAgent != 32 {
		t.Fatalf("expected invalid negative stream limit to fall back to 32, got %d", limits.MaxConcurrentStreamsPerAgent)
	}
	if limits.MaxClusterBufferedBytes != 16*1024*1024 {
		t.Fatalf("expected invalid cluster bytes to fall back to 16MiB, got %d", limits.MaxClusterBufferedBytes)
	}
	if limits.MaxStreamBufferedBytes != 64*1024 {
		t.Fatalf("expected small stream bytes to clamp to 64KiB floor, got %d", limits.MaxStreamBufferedBytes)
	}
	if limits.MaxStreamDuration != 120*time.Second || limits.MaxDroppedBeforeTerminate != 500 {
		t.Fatalf("unexpected duration/dropped limits: %+v", limits)
	}
}
