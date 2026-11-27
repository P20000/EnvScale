package k8s

import (
	"context"
	"fmt"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

func (e *LogEngine) emitFrame(ctx context.Context, frame types.LogStreamFrame) (bool, error) {
	if e.sink == nil {
		return false, nil
	}
	frame.StreamID = e.streamID
	frame.ClusterID = e.clusterID
	if e.sessionID != "" {
		frame.SessionID = e.sessionID
	}
	if frame.Timestamp == "" {
		frame.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	isTerminal := frame.Type == "end" || frame.Type == "error" || frame.Type == "cancel"
	if isTerminal {
		e.flushBackpressureSummary(ctx, true)
		frame.Sequence = e.seq.Add(1)
		timer := time.NewTimer(100 * time.Millisecond)
		defer timer.Stop()
		select {
		case e.sink <- frame:
			return true, nil
		case <-timer.C:
			return false, nil
		case <-ctx.Done():
			select {
			case e.sink <- frame:
				return true, nil
			default:
				return false, nil
			}
		}
	}

	// Flush pending gap diagnostic before delivering subsequent frames so losses are never silent.
	e.flushBackpressureSummary(ctx, false)
	frame.Sequence = e.seq.Add(1)

	select {
	case e.sink <- frame:
		return true, nil
	default:
		exhausted := e.recordDrop(frame.Sequence)
		if exhausted {
			return false, fmt.Errorf("%w: dropped %d frames exceeding limit %d", errBackpressureExhausted, e.totalDroppedCount(), e.maxDropped)
		}
		return false, nil
	}
}

func (e *LogEngine) recordDrop(seq uint64) bool {
	e.backpressureMu.Lock()
	defer e.backpressureMu.Unlock()
	if e.pendingDropped == 0 {
		e.dropGapStart = seq
	}
	e.pendingDropped++
	e.dropGapEnd = seq
	e.totalDropped++
	return e.maxDropped > 0 && e.totalDropped >= e.maxDropped
}

func (e *LogEngine) totalDroppedCount() uint64 {
	e.backpressureMu.Lock()
	defer e.backpressureMu.Unlock()
	return e.totalDropped
}

func (e *LogEngine) flushBackpressureSummary(ctx context.Context, waitTerminal bool) {
	e.backpressureMu.Lock()
	if e.pendingDropped == 0 {
		e.backpressureMu.Unlock()
		return
	}
	pending := e.pendingDropped
	gapStart := e.dropGapStart
	gapEnd := e.dropGapEnd
	diagSeq := e.seq.Add(1)
	diag := types.LogStreamFrame{
		Type:      "diagnostic",
		StreamID:  e.streamID,
		ClusterID: e.clusterID,
		SessionID: e.sessionID,
		Sequence:  diagSeq,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Source:    "system",
		Status:    "backpressure",
		Code:      "stream_backpressure",
		Reason:    fmt.Sprintf("Slow consumer backpressure: dropped %d frame(s) across sequence range %d..%d", pending, gapStart, gapEnd),
	}
	e.backpressureMu.Unlock()

	sent := false
	if waitTerminal {
		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case e.sink <- diag:
			sent = true
		case <-timer.C:
		case <-ctx.Done():
		}
		timer.Stop()
	} else {
		select {
		case e.sink <- diag:
			sent = true
		default:
		}
	}

	if sent {
		e.backpressureMu.Lock()
		if e.pendingDropped == pending {
			e.pendingDropped = 0
			e.dropGapStart = 0
			e.dropGapEnd = 0
		} else if e.pendingDropped > pending {
			e.pendingDropped -= pending
			e.dropGapStart = diagSeq + 1
		}
		e.backpressureMu.Unlock()
	}
}

func (e *LogEngine) updateState(ctx context.Context, target ContainerTarget, status, reason string, retryCount int, nextRetryMs int64) {
	e.mu.Lock()
	if st, ok := e.states[target.SourceID]; ok {
		st.Status = status
		st.Reason = reason
		st.RetryCount = retryCount
	}
	e.mu.Unlock()
	e.emitDiagnostic(ctx, target.SourceID, target.Namespace, target.PodName, target.ContainerName, status, reason, retryCount, nextRetryMs)
}

func (e *LogEngine) emitDiagnostic(ctx context.Context, source, ns, pod, container, status, reason string, retryCount int, nextRetryMs int64) {
	code := ""
	switch status {
	case "restarted":
		code = "container_restarted"
	case "permission_denied":
		code = "permission_denied"
	}
	_, _ = e.emitFrame(ctx, types.LogStreamFrame{
		Type:        "diagnostic",
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Source:      source,
		Namespace:   ns,
		Pod:         pod,
		Container:   container,
		Status:      status,
		Code:        code,
		Reason:      reason,
		RetryCount:  retryCount,
		NextRetryMs: nextRetryMs,
	})
}

func (e *LogEngine) emitStatus(ctx context.Context, scope string) {
	e.mu.RLock()
	total := len(e.states)
	active, retrying, failed := 0, 0, 0
	for _, st := range e.states {
		switch st.Status {
		case "active":
			active++
		case "retrying", "backoff":
			retrying++
		case "failed", "permission_denied":
			failed++
		}
	}
	e.mu.RUnlock()

	_, _ = e.emitFrame(ctx, types.LogStreamFrame{
		Type:            "status",
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		TotalStreams:    total,
		ActiveStreams:   active,
		RetryingStreams: retrying,
		FailedStreams:   failed,
		Scope:           scope,
	})
}

