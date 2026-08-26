// Package chaos implements a fault injection engine for EnvScale's Kubernetes
// Observability Platform. It provides controlled, targeted failure scenarios
// against real Kubernetes API resources (using client-go) so that the full
// alert pipeline, topology canvas, and anomaly detection paths can be exercised
// in a local Minikube/K3s environment without waiting for organic failures.
//
// Supported fault types:
//
//   - "crash"       — Delete a specific pod, forcing the owning ReplicaSet or
//                     Deployment to recreate it. If the pod's restart count
//                     is already high or the image is misconfigured, this
//                     triggers CrashLoopBackOff naturally.
//
//   - "oom-pressure" — Patch a pod's container memory limit to an extremely low
//                      value (e.g. 1Mi) so the OOM killer fires on next spike.
//                      Restores the original limit on ClearFault.
//
//   - "scale-down"  — Patch a Deployment's replicas to 0, simulating a service
//                     outage. Restores to the previous replica count on ClearFault.
//
// All faults are tracked in an in-memory registry (ActiveFaults) so they can
// be listed and cleared via the REST API. Each fault injection and clearance
// emits a ChaosFaultEvent to the WebSocket hub so the React Flow topology
// canvas can immediately highlight the affected node with a chaos badge.
package chaos

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"

	envtypes "github.com/EnvScale/k8s-streamer/pkg/types"
)

// FaultType enumerates the supported chaos fault scenarios.
type FaultType string

const (
	// FaultCrash deletes the target pod forcing an immediate restart cycle.
	FaultCrash FaultType = "crash"

	// FaultOOMPressure patches the target pod's first container memory limit
	// to 1Mi, causing the OOM killer to fire on next memory spike.
	FaultOOMPressure FaultType = "oom-pressure"

	// FaultScaleDown patches the target deployment's replica count to 0,
	// taking all pods in that deployment offline.
	FaultScaleDown FaultType = "scale-down"
)

// activeFault tracks an ongoing fault injection and carries the metadata needed
// to safely reverse it (e.g. the original replica count before scaling to 0).
type activeFault struct {
	FaultID        string    `json:"faultId"`
	FaultType      FaultType `json:"faultType"`
	Target         string    `json:"target"`    // "pod" | "deployment"
	Name           string    `json:"name"`
	Namespace      string    `json:"namespace"`
	ClusterID      string    `json:"clusterId"`
	InjectedAt     time.Time `json:"injectedAt"`
	OriginalValue  string    `json:"originalValue,omitempty"` // stores original replica count or memory limit
}

// ActiveFaultInfo is the public representation of an active fault (returned by ListFaults).
type ActiveFaultInfo struct {
	FaultID    string    `json:"faultId"`
	FaultType  string    `json:"faultType"`
	Target     string    `json:"target"`
	Name       string    `json:"name"`
	Namespace  string    `json:"namespace"`
	ClusterID  string    `json:"clusterId"`
	InjectedAt time.Time `json:"injectedAt"`
}

// HubBroadcaster is the interface the Injector uses to emit chaos events
// to connected WebSocket clients without importing the full hub package.
type HubBroadcaster interface {
	BroadcastEvent(event string, clusterID string, data interface{})
}

// ClientsetProvider resolves a kubernetes.Interface for a given clusterID.
// Implemented by ClusterManager (via its GetCluster method and InformerManager.Clientset()).
type ClientsetProvider interface {
	GetClientset(clusterID string) (kubernetes.Interface, error)
}

// Injector is the chaos fault injection engine. Create one via NewInjector
// and call InjectFault / ClearFault via the REST endpoints in main.go.
type Injector struct {
	provider    ClientsetProvider
	hub         HubBroadcaster
	activeFaults map[string]*activeFault // keyed by faultId
	mu           sync.RWMutex
}

// NewInjector creates a new Injector. provider resolves Kubernetes clientsets
// per cluster, hub receives chaos WebSocket events.
func NewInjector(provider ClientsetProvider, hub HubBroadcaster) *Injector {
	return &Injector{
		provider:     provider,
		hub:          hub,
		activeFaults: make(map[string]*activeFault),
	}
}

// InjectFault executes the requested fault type against the target resource
// in the given cluster. Returns a faultID that can be used to clear it later.
func (inj *Injector) InjectFault(ctx context.Context, clusterID, namespace, name string, faultType FaultType) (string, error) {
	clientset, err := inj.provider.GetClientset(clusterID)
	if err != nil {
		return "", fmt.Errorf("cluster %q not registered: %w", clusterID, err)
	}

	faultID := fmt.Sprintf("%s-%s-%d", faultType, name, time.Now().UnixNano())

	var target string
	var originalValue string

	switch faultType {
	case FaultCrash:
		target = "pod"
		if err := inj.injectCrash(ctx, clientset, namespace, name); err != nil {
			inj.emitFaultEvent(clusterID, faultID, string(faultType), target, name, namespace, "failed",
				fmt.Sprintf("Failed to inject crash: %v", err))
			return "", err
		}
		log.Printf("[Chaos] Crash injected — deleted pod %s/%s on cluster %s", namespace, name, clusterID)

	case FaultOOMPressure:
		target = "pod"
		original, err := inj.injectOOMPressure(ctx, clientset, namespace, name)
		if err != nil {
			inj.emitFaultEvent(clusterID, faultID, string(faultType), target, name, namespace, "failed",
				fmt.Sprintf("Failed to inject OOM pressure: %v", err))
			return "", err
		}
		originalValue = original
		log.Printf("[Chaos] OOM pressure injected — patched memory limit on pod %s/%s (original: %s)", namespace, name, original)

	case FaultScaleDown:
		target = "deployment"
		original, err := inj.injectScaleDown(ctx, clientset, namespace, name)
		if err != nil {
			inj.emitFaultEvent(clusterID, faultID, string(faultType), target, name, namespace, "failed",
				fmt.Sprintf("Failed to inject scale-down: %v", err))
			return "", err
		}
		originalValue = original
		log.Printf("[Chaos] Scale-down injected — deployment %s/%s scaled to 0 (original replicas: %s)", namespace, name, original)

	default:
		return "", fmt.Errorf("unknown fault type %q — supported types: crash, oom-pressure, scale-down", faultType)
	}

	// Register the active fault for later reversal
	fault := &activeFault{
		FaultID:       faultID,
		FaultType:     faultType,
		Target:        target,
		Name:          name,
		Namespace:     namespace,
		ClusterID:     clusterID,
		InjectedAt:    time.Now().UTC(),
		OriginalValue: originalValue,
	}
	inj.mu.Lock()
	inj.activeFaults[faultID] = fault
	inj.mu.Unlock()

	inj.emitFaultEvent(clusterID, faultID, string(faultType), target, name, namespace, "injected",
		fmt.Sprintf("Fault '%s' injected on %s %s/%s", faultType, target, namespace, name))

	return faultID, nil
}

// ClearFault reverses a previously injected fault by faultID.
// For "crash" faults this is a no-op (the pod will self-recover via its ReplicaSet).
// For "oom-pressure" and "scale-down" it actively restores the original state.
func (inj *Injector) ClearFault(ctx context.Context, faultID string) error {
	inj.mu.Lock()
	fault, ok := inj.activeFaults[faultID]
	if !ok {
		inj.mu.Unlock()
		return fmt.Errorf("fault %q not found — it may have already been cleared", faultID)
	}
	delete(inj.activeFaults, faultID)
	inj.mu.Unlock()

	clientset, err := inj.provider.GetClientset(fault.ClusterID)
	if err != nil {
		return fmt.Errorf("cluster %q no longer available: %w", fault.ClusterID, err)
	}

	switch fault.FaultType {
	case FaultCrash:
		// The pod was deleted — Kubernetes will have recreated it via its controller.
		// Nothing to restore; emit cleared event as confirmation.
		log.Printf("[Chaos] Crash fault %s cleared (pod %s/%s self-recovered via controller)", faultID, fault.Namespace, fault.Name)

	case FaultOOMPressure:
		if err := inj.clearOOMPressure(ctx, clientset, fault.Namespace, fault.Name, fault.OriginalValue); err != nil {
			return fmt.Errorf("failed to restore memory limit for pod %s/%s: %w", fault.Namespace, fault.Name, err)
		}
		log.Printf("[Chaos] OOM pressure cleared — restored memory limit on pod %s/%s to %s", fault.Namespace, fault.Name, fault.OriginalValue)

	case FaultScaleDown:
		if err := inj.clearScaleDown(ctx, clientset, fault.Namespace, fault.Name, fault.OriginalValue); err != nil {
			return fmt.Errorf("failed to restore replicas for deployment %s/%s: %w", fault.Namespace, fault.Name, err)
		}
		log.Printf("[Chaos] Scale-down cleared — restored deployment %s/%s to %s replicas", fault.Namespace, fault.Name, fault.OriginalValue)
	}

	inj.emitFaultEvent(fault.ClusterID, faultID, string(fault.FaultType), fault.Target, fault.Name, fault.Namespace, "cleared",
		fmt.Sprintf("Fault '%s' cleared on %s %s/%s", fault.FaultType, fault.Target, fault.Namespace, fault.Name))

	return nil
}

// ListFaults returns the currently active fault injections for a given clusterID.
// Pass an empty clusterID to list all active faults across all clusters.
func (inj *Injector) ListFaults(clusterID string) []ActiveFaultInfo {
	inj.mu.RLock()
	defer inj.mu.RUnlock()

	result := make([]ActiveFaultInfo, 0)
	for _, f := range inj.activeFaults {
		if clusterID != "" && f.ClusterID != clusterID {
			continue
		}
		result = append(result, ActiveFaultInfo{
			FaultID:    f.FaultID,
			FaultType:  string(f.FaultType),
			Target:     f.Target,
			Name:       f.Name,
			Namespace:  f.Namespace,
			ClusterID:  f.ClusterID,
			InjectedAt: f.InjectedAt,
		})
	}
	return result
}

// ActiveFaultCount returns the total number of currently active injections.
func (inj *Injector) ActiveFaultCount() int {
	inj.mu.RLock()
	defer inj.mu.RUnlock()
	return len(inj.activeFaults)
}

// ────────────────────────────────────────────────────────────────────────────
// Internal fault implementation helpers
// ────────────────────────────────────────────────────────────────────────────

// injectCrash deletes the target pod. The owning Deployment/ReplicaSet will
// immediately schedule a replacement, starting a fresh container that may
// enter CrashLoopBackOff if its application has issues.
func (inj *Injector) injectCrash(ctx context.Context, clientset kubernetes.Interface, namespace, podName string) error {
	return clientset.CoreV1().Pods(namespace).Delete(ctx, podName, metav1.DeleteOptions{})
}

// injectOOMPressure patches the first container of the target pod with a
// 1Mi memory limit. The kubelet OOM killer will terminate the container on
// its next memory allocation that exceeds 1 Mi, producing an OOMKilled event.
// Returns the original memory limit string so it can be restored via clearOOMPressure.
func (inj *Injector) injectOOMPressure(ctx context.Context, clientset kubernetes.Interface, namespace, podName string) (string, error) {
	pod, err := clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to fetch pod %s/%s: %w", namespace, podName, err)
	}
	if len(pod.Spec.Containers) == 0 {
		return "", fmt.Errorf("pod %s/%s has no containers", namespace, podName)
	}

	// Capture the current memory limit for later restoration
	originalLimit := pod.Spec.Containers[0].Resources.Limits.Memory().String()
	if originalLimit == "0" {
		// No limit was set — use a safe default to restore to
		originalLimit = "128Mi"
	}

	// Pods are immutable for most fields — we must delete and recreate with the
	// patched spec. We do this by building a new pod spec copy with the patched limit.
	// Note: this approach requires the pod to not be managed by a StatefulSet
	// (which controls pod identity). For Deployments/ReplicaSets this is fine.
	patch := fmt.Sprintf(`{"spec":{"containers":[{"name":%q,"resources":{"limits":{"memory":"1Mi"}}}]}}`, pod.Spec.Containers[0].Name)
	_, err = clientset.CoreV1().Pods(namespace).Patch(
		ctx, podName,
		types.MergePatchType,
		[]byte(patch),
		metav1.PatchOptions{},
	)
	if err != nil {
		// Pods reject most spec patches — fall back to delete-and-recreate with patched spec
		return originalLimit, inj.recreatePodWithMemoryLimit(ctx, clientset, pod, resource.MustParse("1Mi"))
	}

	return originalLimit, nil
}

// recreatePodWithMemoryLimit deletes the pod and recreates it with a patched
// memory limit. This is the fallback for pods whose specs cannot be patched in-place.
func (inj *Injector) recreatePodWithMemoryLimit(ctx context.Context, clientset kubernetes.Interface, pod *corev1.Pod, limit resource.Quantity) error {
	// Delete the existing pod
	if err := clientset.CoreV1().Pods(pod.Namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{}); err != nil {
		return fmt.Errorf("failed to delete pod for recreation: %w", err)
	}

	// Strip runtime-managed fields before recreating
	newPod := pod.DeepCopy()
	newPod.ResourceVersion = ""
	newPod.UID = ""
	newPod.CreationTimestamp = metav1.Time{}
	newPod.Status = corev1.PodStatus{}

	// Apply the OOM-pressure memory limit to the first container
	if newPod.Spec.Containers[0].Resources.Limits == nil {
		newPod.Spec.Containers[0].Resources.Limits = corev1.ResourceList{}
	}
	newPod.Spec.Containers[0].Resources.Limits[corev1.ResourceMemory] = limit

	if _, err := clientset.CoreV1().Pods(pod.Namespace).Create(ctx, newPod, metav1.CreateOptions{}); err != nil {
		return fmt.Errorf("failed to recreate pod with OOM pressure: %w", err)
	}
	return nil
}

// clearOOMPressure restores the original memory limit on the target pod.
func (inj *Injector) clearOOMPressure(ctx context.Context, clientset kubernetes.Interface, namespace, podName, originalLimit string) error {
	patch := fmt.Sprintf(`{"spec":{"containers":[{"name":null,"resources":{"limits":{"memory":%q}}}]}}`, originalLimit)
	_, err := clientset.CoreV1().Pods(namespace).Patch(
		ctx, podName,
		types.MergePatchType,
		[]byte(patch),
		metav1.PatchOptions{},
	)
	return err
}

// injectScaleDown patches the target Deployment's replica count to 0.
// Returns the original replica count as a string for later restoration.
func (inj *Injector) injectScaleDown(ctx context.Context, clientset kubernetes.Interface, namespace, deploymentName string) (string, error) {
	dep, err := clientset.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to fetch deployment %s/%s: %w", namespace, deploymentName, err)
	}

	originalReplicas := fmt.Sprintf("%d", *dep.Spec.Replicas)

	patch := `{"spec":{"replicas":0}}`
	_, err = clientset.AppsV1().Deployments(namespace).Patch(
		ctx, deploymentName,
		types.MergePatchType,
		[]byte(patch),
		metav1.PatchOptions{},
	)
	if err != nil {
		return "", fmt.Errorf("failed to scale deployment %s/%s to 0: %w", namespace, deploymentName, err)
	}
	return originalReplicas, nil
}

// clearScaleDown restores the target Deployment to its original replica count.
func (inj *Injector) clearScaleDown(ctx context.Context, clientset kubernetes.Interface, namespace, deploymentName, originalReplicas string) error {
	patch := fmt.Sprintf(`{"spec":{"replicas":%s}}`, originalReplicas)
	_, err := clientset.AppsV1().Deployments(namespace).Patch(
		ctx, deploymentName,
		types.MergePatchType,
		[]byte(patch),
		metav1.PatchOptions{},
	)
	return err
}

// emitFaultEvent broadcasts a ChaosFaultEvent to all WebSocket clients watching
// the target cluster. Called after each successful inject or clear operation.
func (inj *Injector) emitFaultEvent(clusterID, faultID, faultType, target, name, namespace, status, message string) {
	eventType := envtypes.EventChaosFaultInjected
	if status == "cleared" {
		eventType = envtypes.EventChaosFaultCleared
	}

	inj.hub.BroadcastEvent(eventType, clusterID, envtypes.ChaosFaultEvent{
		FaultID:   faultID,
		FaultType: faultType,
		Target:    target,
		Name:      name,
		Namespace: namespace,
		ClusterID: clusterID,
		Status:    status,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
	})
}
