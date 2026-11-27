package executor

import (
	"fmt"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

// BuildAgentCapabilities constructs ClusterCapabilities from AgentRegistry metadata
// without overclaiming unverified RBAC or unsupported protocol v1 capabilities.
func BuildAgentCapabilities(clusterID string, meta k8s.AgentClusterMeta) ClusterCapabilities {
	now := time.Now().UTC()
	out := ClusterCapabilities{
		ClusterID:       clusterID,
		ConnectionMode:  ModeAgent,
		ProtocolVersion: meta.ProtocolVersion,
		AgentVersion:    meta.AgentVersion,
		StaleAfterSec:   120,
		Capabilities:    make(map[string]CapabilityStatus),
		Resources:       make(map[string]CapabilityStatus, len(discoveryResourceSpecs)),
	}
	if !meta.LastSeen.IsZero() {
		ts := meta.LastSeen.UTC()
		out.LastSyncAt = &ts
	}

	var connReason string
	switch {
	case !meta.Connected && !meta.EverSynced:
		out.ConnectionState = StateWaitingForAgent
		connReason = fmt.Sprintf("Waiting for initial snapshot from agent for cluster %s", clusterID)
	case !meta.Connected && meta.EverSynced:
		out.ConnectionState = StateDisconnected
		connReason = fmt.Sprintf("Agent for cluster %s is disconnected", clusterID)
	case meta.Connected && !meta.HasSnapshot && meta.EverSynced:
		out.ConnectionState = StateReconnecting
		connReason = fmt.Sprintf("Agent for cluster %s reconnected; waiting for fresh baseline snapshot from active session", clusterID)
	case meta.Connected && !meta.HasSnapshot && !meta.EverSynced:
		out.ConnectionState = StateWaitingForAgent
		connReason = fmt.Sprintf("Agent for cluster %s connected; waiting for initial baseline snapshot", clusterID)
	default:
		out.ConnectionState = StateConnected
	}

	for _, spec := range discoveryResourceSpecs {
		if spec.key == "core/v1/secrets" {
			out.Resources[spec.key] = CapabilityStatus{
				State:     CapPermissionDenied,
				Reason:    "Default Agent profile excludes Kubernetes Secret reads (SEC-L3)",
				CheckedAt: now,
			}
			continue
		}
		if out.ConnectionState != StateConnected {
			if spec.optional {
				out.Resources[spec.key] = CapabilityStatus{
					State:     CapNotImplemented,
					Reason:    "Agent protocol v1.0 does not report optional CRD discovery prior to sync",
					CheckedAt: now,
				}
			} else {
				out.Resources[spec.key] = CapabilityStatus{
					State:     CapTemporarilyUnavailable,
					Reason:    connReason,
					CheckedAt: now,
				}
			}
			continue
		}
		if meta.SyncedResources[spec.key] {
			out.Resources[spec.key] = CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
		} else if spec.optional {
			out.Resources[spec.key] = CapabilityStatus{
				State:     CapNotImplemented,
				Reason:    "Agent protocol v1.0 snapshot did not populate this optional CRD resource",
				CheckedAt: now,
			}
		} else {
			out.Resources[spec.key] = CapabilityStatus{
				State:     CapTemporarilyUnavailable,
				Reason:    "Not populated in Agent v1 snapshot; resource permissions or availability unverified",
				CheckedAt: now,
			}
		}
	}

	if out.ConnectionState != StateConnected {
		for _, capKey := range allCapabilityKeys() {
			if capKey == CapChaosOOMPressure || capKey == CapResourceApply {
				out.Capabilities[capKey] = CapabilityStatus{State: CapNotImplemented, Reason: "Deferred feature", CheckedAt: now}
				continue
			}
			out.Capabilities[capKey] = CapabilityStatus{State: CapTemporarilyUnavailable, Reason: connReason, CheckedAt: now}
		}
		return out
	}

	out.Capabilities[CapTopology] = out.Resources["core/v1/pods"]
	if out.Capabilities[CapTopology].State != CapSupportedWorking && meta.HasSnapshot {
		// Allow topology reporting when snapshot delivered non-nil workloads (e.g. Deployments) even if cluster had no pods.
		out.Capabilities[CapTopology] = CapabilityStatus{State: CapSupportedWorking, CheckedAt: now}
	}
	out.Capabilities[CapEvents] = out.Resources["core/v1/events"]

	if meta.ProtocolVersion == "2.0" {
		if rep, ok := meta.ReportedCapabilities[CapLogs]; ok && rep.State != "" {
			out.Capabilities[CapLogs] = CapabilityStatus{
				State:     CapabilityState(rep.State),
				Reason:    rep.Reason,
				CheckedAt: now,
			}
		} else {
			out.Capabilities[CapLogs] = CapabilityStatus{
				State:     CapTemporarilyUnavailable,
				Reason:    "Agent protocol v2.0 connected; waiting for capability report for logs",
				CheckedAt: now,
			}
		}
	}

	v1Msg := "Agent protocol v1.0 supports snapshot discovery only; upgrade agent/protocol v2.0 for logs, metrics, and remote operations"
	deferredCaps := []string{
		CapMetrics, CapResourceDelete, CapResourceApply,
		CapDeploymentScale, CapDeploymentRollback, CapChaosPodCrash, CapChaosScaleDown, CapPDBValidation,
	}
	if meta.ProtocolVersion != "2.0" {
		deferredCaps = append([]string{CapLogs}, deferredCaps...)
	}
	for _, capKey := range deferredCaps {
		reason := v1Msg
		if meta.ProtocolVersion == "2.0" {
			reason = fmt.Sprintf("Capability %q over Agent protocol v2.0 is scheduled for a subsequent executor slice", capKey)
		}
		out.Capabilities[capKey] = CapabilityStatus{State: CapNotImplemented, Reason: reason, CheckedAt: now}
	}
	out.Capabilities[CapChaosOOMPressure] = CapabilityStatus{
		State:     CapNotImplemented,
		Reason:    "OOM pressure chaos is deferred until deterministic recovery tests pass",
		CheckedAt: now,
	}
	return out
}

