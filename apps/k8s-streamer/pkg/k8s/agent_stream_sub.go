package k8s

import (
	"fmt"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// AgentSessionLimits bounds concurrent streams, memory, duration, and drop tolerances per Agent cluster.
type AgentSessionLimits struct {
	MaxConcurrentStreamsPerAgent int
	MaxClusterBufferedBytes      int64
	MaxStreamBufferedBytes       int64
	MaxStreamDuration            time.Duration
	MaxDroppedBeforeTerminate    uint64
}

// DefaultAgentSessionLimits returns validated Agent session limits, honoring bounded environment overrides.
func DefaultAgentSessionLimits() AgentSessionLimits {
	return AgentSessionLimits{
		MaxConcurrentStreamsPerAgent: envIntBounded("ENVSCALE_MAX_AGENT_LOG_STREAMS", 32, 1, 256),
		MaxClusterBufferedBytes:      envInt64Bounded("ENVSCALE_MAX_AGENT_CLUSTER_BYTES", 16*1024*1024, 1*1024*1024, 256*1024*1024),
		MaxStreamBufferedBytes:       envInt64Bounded("ENVSCALE_MAX_AGENT_STREAM_BYTES", 2*1024*1024, 64*1024, 64*1024*1024),
		MaxStreamDuration:            time.Duration(envIntBounded("ENVSCALE_MAX_AGENT_STREAM_DURATION_SEC", 86400, 10, 604800)) * time.Second,
		MaxDroppedBeforeTerminate:    uint64(envInt64Bounded("ENVSCALE_MAX_AGENT_DROPPED_FRAMES", 4096, 1, 1000000)),
	}
}

func envIntBounded(name string, def, minVal, maxVal int) int {
	raw := os.Getenv(name)
	if raw == "" {
		return def
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return def
	}
	if parsed < minVal {
		return minVal
	}
	if parsed > maxVal {
		return maxVal
	}
	return parsed
}

func envInt64Bounded(name string, def, minVal, maxVal int64) int64 {
	raw := os.Getenv(name)
	if raw == "" {
		return def
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || parsed <= 0 {
		return def
	}
	if parsed < minVal {
		return minVal
	}
	if parsed > maxVal {
		return maxVal
	}
	return parsed
}

type queuedLogFrame struct {
	frame      types.LogStreamFrame
	size       int64
	isTerminal bool
}

type agentStreamSub struct {
	streamID     string
	clusterID    string
	sessionID    string
	sink         chan<- types.LogStreamFrame
	clusterBytes *atomic.Int64
	limits       AgentSessionLimits

	done      chan struct{}
	termCh    chan struct{}
	stopCh    chan struct{}
	termOnce  sync.Once
	stopOnce  sync.Once
	doneOnce  sync.Once

	mu             sync.Mutex
	cond           *sync.Cond
	queue          []queuedLogFrame
	streamBytes    int64
	seq            uint64
	lastInboundSeq uint64
	pendingDropped uint64
	dropGapStart   uint64
	dropGapEnd     uint64
	totalDropped   uint64
	terminating    bool
	closed         bool
}

func newAgentStreamSub(
	streamID, clusterID, sessionID string,
	sink chan<- types.LogStreamFrame,
	clusterBytes *atomic.Int64,
	limits AgentSessionLimits,
) *agentStreamSub {
	sub := &agentStreamSub{
		streamID:     streamID,
		clusterID:    clusterID,
		sessionID:    sessionID,
		sink:         sink,
		clusterBytes: clusterBytes,
		limits:       limits,
		done:         make(chan struct{}),
		termCh:       make(chan struct{}),
		stopCh:       make(chan struct{}),
	}
	sub.cond = sync.NewCond(&sub.mu)
	go sub.runDelivery()
	return sub
}

func estimateFrameBytes(f types.LogStreamFrame) int64 {
	return int64(len(f.Message) + len(f.Reason) + len(f.Source) + 256)
}

func (s *agentStreamSub) allocateSeqLocked(inbound uint64) uint64 {
	if inbound > s.seq {
		if s.lastInboundSeq > 0 && inbound > s.lastInboundSeq+1 {
			gap := inbound - s.lastInboundSeq - 1
			if s.pendingDropped == 0 {
				s.dropGapStart = s.lastInboundSeq + 1
			}
			s.pendingDropped += gap
			s.dropGapEnd = inbound - 1
			s.totalDropped += gap
		}
		s.lastInboundSeq = inbound
		s.seq = inbound
		return inbound
	}
	if inbound > 0 && inbound > s.lastInboundSeq {
		s.lastInboundSeq = inbound
	}
	s.seq++
	return s.seq
}

// enqueue inserts a validated Agent frame into this stream's byte-bounded queue.
// Returns (accepted, exhausted). Exceeding per-stream or cluster byte budgets never silently
// discards without incrementing dropped counters and surfacing a backpressure diagnostic.
func (s *agentStreamSub) enqueue(frame types.LogStreamFrame) (accepted bool, exhausted bool) {
	isTerminal := frame.Type == "end" || frame.Type == "error" || frame.Type == "cancel"

	s.mu.Lock()
	if s.closed || (s.terminating && !isTerminal) {
		s.mu.Unlock()
		return false, false
	}

	frame.StreamID = s.streamID
	frame.ClusterID = s.clusterID
	frame.SessionID = s.sessionID
	if frame.Timestamp == "" {
		frame.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	frame.Sequence = s.allocateSeqLocked(frame.Sequence)

	if isTerminal {
		s.terminating = true
		s.termOnce.Do(func() { close(s.termCh) })
		s.queue = append(s.queue, queuedLogFrame{frame: frame, isTerminal: true})
		s.cond.Broadcast()
		s.mu.Unlock()
		return true, false
	}

	sz := estimateFrameBytes(frame)
	overStream := s.limits.MaxStreamBufferedBytes > 0 && s.streamBytes+sz > s.limits.MaxStreamBufferedBytes
	overCluster := s.limits.MaxClusterBufferedBytes > 0 && s.clusterBytes != nil && s.clusterBytes.Load()+sz > s.limits.MaxClusterBufferedBytes
	if overStream || overCluster {
		if s.pendingDropped == 0 {
			s.dropGapStart = frame.Sequence
		}
		s.pendingDropped++
		s.dropGapEnd = frame.Sequence
		s.totalDropped++
		exhausted = s.limits.MaxDroppedBeforeTerminate > 0 && s.totalDropped >= s.limits.MaxDroppedBeforeTerminate
		s.cond.Broadcast()
		s.mu.Unlock()
		return false, exhausted
	}

	s.streamBytes += sz
	if s.clusterBytes != nil {
		s.clusterBytes.Add(sz)
	}
	s.queue = append(s.queue, queuedLogFrame{frame: frame, size: sz})
	s.cond.Broadcast()
	s.mu.Unlock()
	return true, false
}

// terminateWithFrame appends an explicit terminal error/end frame and lets runDelivery flush cleanly.
func (s *agentStreamSub) terminateWithFrame(code, status, reason string) {
	frameType := "error"
	if status == "ended" {
		frameType = "end"
	} else if status == "canceled" {
		frameType = "cancel"
	}

	s.mu.Lock()
	if s.closed || s.terminating {
		s.mu.Unlock()
		return
	}
	s.terminating = true
	s.termOnce.Do(func() { close(s.termCh) })
	s.seq++
	term := types.LogStreamFrame{
		Type:      frameType,
		StreamID:  s.streamID,
		ClusterID: s.clusterID,
		SessionID: s.sessionID,
		Sequence:  s.seq,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Source:    "system",
		Status:    status,
		Code:      code,
		Reason:    reason,
	}
	s.queue = append(s.queue, queuedLogFrame{frame: term, isTerminal: true})
	s.cond.Broadcast()
	s.mu.Unlock()
}

// cancelImmediate aborts delivery immediately (used on caller-initiated cancel/Close).
func (s *agentStreamSub) cancelImmediate() {
	s.mu.Lock()
	s.closed = true
	s.terminating = true
	s.releaseQueuedBytesLocked()
	s.termOnce.Do(func() { close(s.termCh) })
	s.stopOnce.Do(func() { close(s.stopCh) })
	s.cond.Broadcast()
	s.mu.Unlock()
}

func (s *agentStreamSub) releaseQueuedBytesLocked() {
	if s.clusterBytes != nil && s.streamBytes > 0 {
		s.clusterBytes.Add(-s.streamBytes)
	}
	s.streamBytes = 0
	s.queue = nil
}

func (s *agentStreamSub) runDelivery() {
	defer func() {
		s.mu.Lock()
		s.closed = true
		s.releaseQueuedBytesLocked()
		s.mu.Unlock()
		s.doneOnce.Do(func() { close(s.done) })
	}()

	for {
		s.mu.Lock()
		for len(s.queue) == 0 && !s.closed && !s.terminating {
			s.cond.Wait()
		}
		if s.closed {
			s.mu.Unlock()
			return
		}

		// Deliver any pending sequence-gap backpressure diagnostic before normal or terminal frames.
		if s.pendingDropped > 0 {
			pending := s.pendingDropped
			gapStart := s.dropGapStart
			gapEnd := s.dropGapEnd
			s.seq++
			diag := types.LogStreamFrame{
				Type:      "diagnostic",
				StreamID:  s.streamID,
				ClusterID: s.clusterID,
				SessionID: s.sessionID,
				Sequence:  s.seq,
				Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
				Source:    "system",
				Status:    "backpressure",
				Code:      "stream_backpressure",
				Reason:    fmt.Sprintf("Slow consumer backpressure: dropped %d agent frame(s) across sequence range %d..%d", pending, gapStart, gapEnd),
			}
			isTerm := s.terminating
			s.mu.Unlock()

			if !s.sendToSink(diag, isTerm) {
				if isTerm {
					return
				}
				continue
			}

			s.mu.Lock()
			if s.pendingDropped == pending {
				s.pendingDropped = 0
				s.dropGapStart = 0
				s.dropGapEnd = 0
			} else if s.pendingDropped > pending {
				s.pendingDropped -= pending
			}
			s.mu.Unlock()
			continue
		}

		if len(s.queue) == 0 {
			if s.terminating {
				s.mu.Unlock()
				return
			}
			s.mu.Unlock()
			continue
		}

		item := s.queue[0]
		s.queue = s.queue[1:]
		if item.size > 0 {
			s.streamBytes -= item.size
			if s.clusterBytes != nil {
				s.clusterBytes.Add(-item.size)
			}
		}
		isTerm := item.isTerminal || s.terminating
		s.mu.Unlock()

		_ = s.sendToSink(item.frame, isTerm)
		if item.isTerminal {
			return
		}
	}
}

func (s *agentStreamSub) sendToSink(frame types.LogStreamFrame, bounded bool) bool {
	if bounded {
		timer := time.NewTimer(100 * time.Millisecond)
		defer timer.Stop()
		select {
		case s.sink <- frame:
			return true
		case <-timer.C:
			return false
		case <-s.stopCh:
			return false
		}
	}

	select {
	case s.sink <- frame:
		return true
	case <-s.termCh:
		timer := time.NewTimer(100 * time.Millisecond)
		defer timer.Stop()
		select {
		case s.sink <- frame:
			return true
		case <-timer.C:
			return false
		case <-s.stopCh:
			return false
		}
	case <-s.stopCh:
		return false
	}
}

