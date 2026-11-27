package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

func TestLogEngine_LinesExceeding64KiBAndOversizedTruncation(t *testing.T) {
	line100K := strings.Repeat("A", 100*1024)
	line600K := strings.Repeat("B", 600*1024)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/namespaces/prod/pods/big-0":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "big-0", Namespace: "prod"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
			})
		case "/api/v1/namespaces/prod/pods/big-0/log":
			w.Header().Set("Content-Type", "text/plain")
			_, _ = fmt.Fprintf(w, "2026-11-27T12:00:00Z INFO %s\n", line100K)
			_, _ = fmt.Fprintf(w, "2026-11-27T12:00:01Z WARN %s\n", line600K)
			_, _ = fmt.Fprintf(w, "2026-11-27T12:00:02Z INFO recovered-after-oversized\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cs, err := kubernetes.NewForConfig(&rest.Config{Host: srv.URL, QPS: 100, Burst: 200})
	if err != nil {
		t.Fatalf("clientset err: %v", err)
	}

	sink := make(chan types.LogStreamFrame, 32)
	eng := NewLogEngine(cs, "c1", "s-large", "", sink)
	// Keep 256 KiB cap (already default) explicitly verified
	eng.SetLimits(DefaultMaxLogLineBytes, 100, 10*time.Millisecond)

	err = eng.Run(context.Background(), types.LogStreamStartPayload{
		StreamID:   "s-large",
		Namespace:  "prod",
		Kind:       "pod",
		Name:       "big-0",
		Container:  "app",
		Follow:     false,
		Timestamps: true,
	})
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}
	close(sink)

	var logs []types.LogStreamFrame
	var sawTruncDiag bool
	for f := range sink {
		if f.Type == "log" {
			logs = append(logs, f)
		} else if f.Type == "diagnostic" && f.Code == "log_line_truncated" {
			sawTruncDiag = true
		}
	}

	if len(logs) != 3 {
		t.Fatalf("expected all 3 lines (100KiB intact + 600KiB truncated + trailing normal line), got %d", len(logs))
	}
	if !strings.Contains(logs[0].Message, line100K) {
		t.Fatalf("expected 100KiB line (>64KiB bufio.Scanner default) intact; got len=%d", len(logs[0].Message))
	}
	if !sawTruncDiag {
		t.Fatalf("expected explicit log_line_truncated diagnostic for 600KiB line")
	}
	if !strings.HasSuffix(logs[1].Message, " ... [truncated]") || len(logs[1].Message) > DefaultMaxLogLineBytes+32 {
		t.Fatalf("expected 600KiB line bounded & marked truncated, got len=%d", len(logs[1].Message))
	}
	if logs[2].Message != "INFO recovered-after-oversized" {
		t.Fatalf("expected stream to continue cleanly after oversized entry, got %q", logs[2].Message)
	}
}

func TestLogEngine_FollowIdenticalTimestampsAndReconnectDedup(t *testing.T) {
	var attempt atomic.Int32
	var seenSinceTimes []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/namespaces/prod/pods/dup-0":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "dup-0", Namespace: "prod"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status:     corev1.PodStatus{Phase: corev1.PodRunning},
			})
		case "/api/v1/namespaces/prod/pods/dup-0/log":
			cur := attempt.Add(1)
			seenSinceTimes = append(seenSinceTimes, r.URL.Query().Get("sinceTime"))
			w.Header().Set("Content-Type", "text/plain")
			if cur == 1 {
				_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-1")
				_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-2")
				_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-2")
				return // forces EOF -> reconnect
			}
			// Replays the prior boundary-second entries PLUS two brand new entries with the exact same timestamp!
			_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-1")
			_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-2")
			_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-2")
			_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO same-sec-3")
			_, _ = fmt.Fprintln(w, "2026-11-27T12:00:01Z INFO next-sec-4")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			<-r.Context().Done()
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cs, _ := kubernetes.NewForConfig(&rest.Config{Host: srv.URL, QPS: 100, Burst: 200})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sink := make(chan types.LogStreamFrame, 64)
	eng := NewLogEngine(cs, "c1", "s-dup", "", sink)
	eng.SetLimits(0, 0, 10*time.Millisecond)

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = eng.Run(ctx, types.LogStreamStartPayload{
			StreamID: "s-dup", Namespace: "prod", Kind: "pod", Name: "dup-0", Container: "app", Follow: true, Timestamps: true,
		})
	}()

	var gotMsgs []string
	var lastSeq uint64
	deadline := time.Now().Add(3 * time.Second)
	for len(gotMsgs) < 5 && time.Now().Before(deadline) {
		select {
		case f := <-sink:
			if f.Sequence <= lastSeq {
				t.Fatalf("sequence not strictly monotonic: %d <= %d", f.Sequence, lastSeq)
			}
			lastSeq = f.Sequence
			if f.Type == "log" {
				gotMsgs = append(gotMsgs, f.Message)
			}
		case <-time.After(200 * time.Millisecond):
		}
	}
	cancel()
	<-done

	want := []string{
		"INFO same-sec-1",
		"INFO same-sec-2",
		"INFO same-sec-2",
		"INFO same-sec-3",
		"INFO next-sec-4",
	}
	if len(gotMsgs) != len(want) {
		t.Fatalf("expected exact boundary-deduped msgs %v, got %v", want, gotMsgs)
	}
	for i := range want {
		if gotMsgs[i] != want[i] {
			t.Fatalf("mismatch at %d: want %q, got %q (all=%v)", i, want[i], gotMsgs[i], gotMsgs)
		}
	}
	if len(seenSinceTimes) < 2 || seenSinceTimes[1] == "" {
		t.Fatalf("expected reconnect to pass sinceTime watermark, got %v", seenSinceTimes)
	}
}

func TestLogEngine_FollowContainerRestartResetsResumeState(t *testing.T) {
	var restarted atomic.Bool
	var attempt atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/namespaces/prod/pods/rest-0":
			cid := "containerd://c-old"
			rc := int32(0)
			if restarted.Load() {
				cid = "containerd://c-new"
				rc = 1
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "rest-0", Namespace: "prod"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
				Status: corev1.PodStatus{
					Phase:             corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{{Name: "app", ContainerID: cid, RestartCount: rc}},
				},
			})
		case "/api/v1/namespaces/prod/pods/rest-0/log":
			cur := attempt.Add(1)
			w.Header().Set("Content-Type", "text/plain")
			if cur == 1 {
				_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO boot-entry")
				restarted.Store(true)
				return // simulate container crash/exit EOF before restart
			}
			// After container restart, even an identical-text log entry at the same timestamp must be delivered.
			_, _ = fmt.Fprintln(w, "2026-11-27T12:00:00Z INFO boot-entry")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			<-r.Context().Done()
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cs, _ := kubernetes.NewForConfig(&rest.Config{Host: srv.URL, QPS: 100, Burst: 200})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sink := make(chan types.LogStreamFrame, 64)
	eng := NewLogEngine(cs, "c1", "s-restart", "", sink)
	eng.SetLimits(0, 0, 10*time.Millisecond)

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = eng.Run(ctx, types.LogStreamStartPayload{
			StreamID: "s-restart", Namespace: "prod", Kind: "pod", Name: "rest-0", Container: "app", Follow: true, Timestamps: true,
		})
	}()

	var logCount int
	var sawRestartDiag bool
	deadline := time.Now().Add(3 * time.Second)
	for (logCount < 2 || !sawRestartDiag) && time.Now().Before(deadline) {
		select {
		case f := <-sink:
			if f.Type == "log" && f.Message == "INFO boot-entry" {
				logCount++
			}
			if f.Type == "diagnostic" && f.Code == "container_restarted" {
				sawRestartDiag = true
			}
		case <-time.After(200 * time.Millisecond):
		}
	}
	cancel()
	<-done

	if !sawRestartDiag || logCount < 2 {
		t.Fatalf("expected container_restarted diagnostic (%v) and both pre/post-restart logs (%d)", sawRestartDiag, logCount)
	}
}

func TestLogEngine_SlowConsumerEmitsSequenceGapAndBackpressureDiagnostic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/namespaces/prod/pods/bp-0":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{Name: "bp-0", Namespace: "prod"},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "app"}}},
			})
		case "/api/v1/namespaces/prod/pods/bp-0/log":
			w.Header().Set("Content-Type", "text/plain")
			for i := 1; i <= 30; i++ {
				_, _ = fmt.Fprintf(w, "2026-11-27T12:00:00Z INFO burst-%d\n", i)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	cs, _ := kubernetes.NewForConfig(&rest.Config{Host: srv.URL, QPS: 100, Burst: 200})

	// Tight sink (cap 2); reader pauses to induce backpressure, then drains diagnostics and terminal error
	sink := make(chan types.LogStreamFrame, 2)
	eng := NewLogEngine(cs, "c1", "s-bp", "", sink)
	eng.SetLimits(0, 10, 10*time.Millisecond)

	runDone := make(chan error, 1)
	go func() {
		runDone <- eng.Run(context.Background(), types.LogStreamStartPayload{
			StreamID: "s-bp", Namespace: "prod", Kind: "pod", Name: "bp-0", Container: "app", Follow: false, Timestamps: true,
		})
	}()

	// Pause briefly so the 30-line burst saturates the 2-slot buffer and triggers drops, then drain while terminal flush waits
	time.Sleep(25 * time.Millisecond)

	var err error
	var sawBP, sawExhausted bool
drainSlow:
	for {
		select {
		case runErr := <-runDone:
			err = runErr
			for {
				select {
				case f := <-sink:
					if f.Type == "diagnostic" && f.Code == "stream_backpressure" && strings.Contains(f.Reason, "sequence range") {
						sawBP = true
					}
					if f.Type == "error" && f.Code == "resource_exhausted" {
						sawExhausted = true
					}
				default:
					break drainSlow
				}
			}
		case f := <-sink:
			if f.Type == "diagnostic" && f.Code == "stream_backpressure" && strings.Contains(f.Reason, "sequence range") {
				sawBP = true
			}
			if f.Type == "error" && f.Code == "resource_exhausted" {
				sawExhausted = true
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for slow-consumer termination")
		}
	}

	if err == nil {
		t.Fatalf("expected resource_exhausted error when maxDropped=10 exceeded on full sink")
	}
	if !sawBP || !sawExhausted {
		t.Fatalf("expected both backpressure diagnostic (%v) and resource_exhausted frame (%v)", sawBP, sawExhausted)
	}
}
