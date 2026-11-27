package executor

import (
	"fmt"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

const maxAllowedTailLines int64 = 10000

var (
	logStreamSeq       atomic.Uint64
	k8sDNSLabelRe      = regexp.MustCompile(`^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$`)
	k8sDNSSubdomainRe  = regexp.MustCompile(`^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$`)
	streamIDRe         = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)
	allowedLogKindsSet = map[string]bool{
		"pod":         true,
		"deployment":  true,
		"statefulset": true,
		"daemonset":   true,
		"job":         true,
		"replicaset":  true,
		"service":     true,
		"ingress":     true,
		"node":        true,
		"all":         true,
	}
)

// GenerateLogStreamID creates a collision-resistant stream identifier.
func GenerateLogStreamID() string {
	return fmt.Sprintf("logs-%d-%d", time.Now().UTC().UnixNano(), logStreamSeq.Add(1))
}

// ValidateAndNormalizeLogRequest validates and normalizes log stream parameters strictly,
// rejecting invalid Kubernetes names, unsupported resource kinds, path traversal segments,
// and out-of-range tail/since filters.
func ValidateAndNormalizeLogRequest(req LogStreamRequest) (LogStreamRequest, error) {
	out := req

	out.StreamID = strings.TrimSpace(out.StreamID)
	if out.StreamID == "" {
		out.StreamID = GenerateLogStreamID()
	} else if !streamIDRe.MatchString(out.StreamID) {
		return LogStreamRequest{}, fmt.Errorf("%w: invalid streamId %q", ErrInvalidLogRequest, out.StreamID)
	}

	out.Kind = strings.ToLower(strings.TrimSpace(out.Kind))
	if out.Kind == "" {
		out.Kind = "pod"
	} else if out.Kind == "cluster" || out.Kind == "all-resources" {
		out.Kind = "all"
	}
	if !allowedLogKindsSet[out.Kind] {
		return LogStreamRequest{}, fmt.Errorf("%w: unsupported log resource kind %q", ErrInvalidLogRequest, req.Kind)
	}

	rawNs := strings.TrimSpace(out.Namespace)
	if rawNs == "" || strings.EqualFold(rawNs, "all") || strings.EqualFold(rawNs, "_all") {
		out.Namespace = "all"
	} else {
		if !k8sDNSLabelRe.MatchString(rawNs) {
			return LogStreamRequest{}, fmt.Errorf("%w: invalid namespace %q", ErrInvalidLogRequest, out.Namespace)
		}
		out.Namespace = rawNs
	}

	rawName := strings.TrimSpace(out.Name)
	if out.Kind == "pod" {
		if rawName == "" || strings.EqualFold(rawName, "all") || strings.EqualFold(rawName, "all-resources") {
			return LogStreamRequest{}, fmt.Errorf("%w: pod name is required when kind is pod", ErrInvalidLogRequest)
		}
		if !k8sDNSSubdomainRe.MatchString(rawName) || strings.Contains(rawName, "..") {
			return LogStreamRequest{}, fmt.Errorf("%w: invalid pod name %q", ErrInvalidLogRequest, out.Name)
		}
		out.Name = rawName
	} else if rawName == "" || strings.EqualFold(rawName, "all") || strings.EqualFold(rawName, "all-resources") {
		out.Name = "all"
	} else {
		if !k8sDNSSubdomainRe.MatchString(rawName) || strings.Contains(rawName, "..") {
			return LogStreamRequest{}, fmt.Errorf("%w: invalid resource name %q", ErrInvalidLogRequest, out.Name)
		}
		out.Name = rawName
	}

	out.Container = strings.TrimSpace(out.Container)
	if out.Container != "" && !k8sDNSLabelRe.MatchString(out.Container) {
		return LogStreamRequest{}, fmt.Errorf("%w: invalid container name %q", ErrInvalidLogRequest, out.Container)
	}

	if out.TailLines < 0 {
		out.TailLines = 100
	} else if out.TailLines > maxAllowedTailLines {
		out.TailLines = maxAllowedTailLines
	}

	if out.SinceSeconds != nil && *out.SinceSeconds <= 0 {
		return LogStreamRequest{}, fmt.Errorf("%w: sinceSeconds must be positive", ErrInvalidLogRequest)
	}

	if out.SinceTime != nil {
		t := out.SinceTime.UTC()
		out.SinceTime = &t
	}

	return out, nil
}

