package k8s

import (
	"context"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// DiscoverContainers resolves concrete pod/container targets using clientset and optional container filter.
func (e *LogEngine) DiscoverContainers(ctx context.Context, namespace, name, kind, containerFilter string) ([]ContainerTarget, error) {
	if e.clientset == nil {
		return nil, fmt.Errorf("kubernetes clientset unavailable")
	}

	cleanNs := strings.TrimSpace(namespace)
	isAllNs := cleanNs == "" || strings.EqualFold(cleanNs, "all") || strings.EqualFold(cleanNs, "_all")
	cleanName := strings.TrimSpace(name)
	normKind := strings.ToLower(strings.TrimSpace(kind))
	cleanContainer := strings.TrimSpace(containerFilter)

	// Fast path for a concrete single Pod lookup (preserves exact 404/403 errors).
	if normKind == "pod" && !isAllNs && cleanName != "" && !strings.EqualFold(cleanName, "all") {
		pod, err := e.clientset.CoreV1().Pods(cleanNs).Get(ctx, cleanName, metav1.GetOptions{})
		if err != nil {
			if apierrors.IsForbidden(err) {
				return nil, fmt.Errorf("%w: %v", ErrLogPermissionDenied, err)
			}
			if apierrors.IsNotFound(err) {
				return nil, fmt.Errorf("%w: pod %s/%s not found", ErrLogResourceNotFound, cleanNs, cleanName)
			}
			return nil, err
		}
		return collectPodContainers(*pod, cleanContainer, true)
	}

	listNs := cleanNs
	if isAllNs {
		listNs = metav1.NamespaceAll
	}
	podList, err := e.clientset.CoreV1().Pods(listNs).List(ctx, metav1.ListOptions{})
	if err != nil {
		if apierrors.IsForbidden(err) || strings.Contains(strings.ToLower(err.Error()), "forbidden") {
			e.emitDiagnostic(ctx, "system", listNs, "", "", "permission_denied", fmt.Sprintf("RBAC error listing pods: %v", err), 0, 0)
			if isAllNs {
				podList, err = e.clientset.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
			}
		}
		if err != nil {
			if apierrors.IsForbidden(err) || strings.Contains(strings.ToLower(err.Error()), "forbidden") {
				return nil, fmt.Errorf("%w: %v", ErrLogPermissionDenied, err)
			}
			return nil, fmt.Errorf("failed to list pods in namespace %q: %w", listNs, err)
		}
	}

	lowerName := strings.ToLower(cleanName)
	isAllResources := lowerName == "" || lowerName == "all" || lowerName == "all-resources" || normKind == "all"

	var targets []ContainerTarget
	matchedPods := 0
	for _, pod := range podList.Items {
		pName := strings.ToLower(pod.Name)
		matches := isAllResources || (normKind == "pod" && pName == lowerName) ||
			(normKind != "pod" && (strings.HasPrefix(pName, lowerName) || strings.Contains(pName, lowerName)))
		if !matches {
			continue
		}
		matchedPods++
		podTargets, err := collectPodContainers(pod, cleanContainer, false)
		if err == nil {
			targets = append(targets, podTargets...)
		}
	}

	if cleanContainer != "" && matchedPods > 0 && len(targets) == 0 {
		return nil, fmt.Errorf("%w: container %q not found in matching pods", ErrLogContainerNotFound, cleanContainer)
	}
	return targets, nil
}

func collectPodContainers(pod corev1.Pod, containerFilter string, requireMatch bool) ([]ContainerTarget, error) {
	var targets []ContainerTarget
	for _, c := range pod.Spec.Containers {
		if containerFilter != "" && c.Name != containerFilter {
			continue
		}
		targets = append(targets, ContainerTarget{
			Namespace:     pod.Namespace,
			PodName:       pod.Name,
			ContainerName: c.Name,
			SourceID:      fmt.Sprintf("%s/%s/%s", pod.Namespace, pod.Name, c.Name),
		})
	}
	for _, ic := range pod.Spec.InitContainers {
		if containerFilter != "" && ic.Name != containerFilter {
			continue
		}
		includeInit := containerFilter != "" // explicitly requested init container
		if !includeInit {
			for _, st := range pod.Status.InitContainerStatuses {
				if st.Name == ic.Name && (st.State.Running != nil || (st.State.Terminated != nil && st.State.Terminated.ExitCode != 0)) {
					includeInit = true
					break
				}
			}
		}
		if includeInit {
			targets = append(targets, ContainerTarget{
				Namespace:     pod.Namespace,
				PodName:       pod.Name,
				ContainerName: ic.Name,
				IsInit:        true,
				SourceID:      fmt.Sprintf("%s/%s/%s", pod.Namespace, pod.Name, ic.Name),
			})
		}
	}
	if requireMatch && len(targets) == 0 {
		if containerFilter != "" {
			return nil, fmt.Errorf("%w: container %q not found in pod %s/%s", ErrLogContainerNotFound, containerFilter, pod.Namespace, pod.Name)
		}
		return nil, fmt.Errorf("%w: pod %s/%s has no containers", ErrLogContainerNotFound, pod.Namespace, pod.Name)
	}
	return targets, nil
}

func (e *LogEngine) runResourceEvents(ctx context.Context, namespace, name, kind string, follow bool) error {
	events, err := e.clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		code := ClassifyK8sLogError(err)
		status := "failed"
		if code == "permission_denied" {
			status = "permission_denied"
		}
		e.emitDiagnostic(ctx, "system", namespace, name, "", status, err.Error(), 0, 0)
		e.emitFrame(ctx, types.LogStreamFrame{
			Type:      "error",
			Namespace: namespace,
			Pod:       name,
			Status:    status,
			Code:      code,
			Reason:    err.Error(),
		})
		return err
	}

	for _, evt := range events.Items {
		if matchesEventResource(evt, name) {
			e.emitEventFrame(ctx, namespace, kind, evt)
		}
	}

	if !follow {
		e.emitFrame(ctx, types.LogStreamFrame{
			Type:   "end",
			Status: "ended",
			Reason: "Event stream completed",
		})
		return nil
	}

	watcher, err := e.clientset.CoreV1().Events(namespace).Watch(ctx, metav1.ListOptions{})
	if err != nil {
		return nil
	}
	defer watcher.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-watcher.ResultChan():
			if !ok {
				e.emitFrame(ctx, types.LogStreamFrame{Type: "end", Status: "ended", Reason: "Event watch closed"})
				return nil
			}
			if evt, ok := event.Object.(*corev1.Event); ok && evt != nil && matchesEventResource(*evt, name) {
				e.emitEventFrame(ctx, namespace, kind, *evt)
			}
		}
	}
}

func (e *LogEngine) emitEventFrame(ctx context.Context, namespace, kind string, evt corev1.Event) {
	lvl := "INFO"
	if evt.Type == corev1.EventTypeWarning {
		lvl = "WARN"
	}
	e.emitFrame(ctx, types.LogStreamFrame{
		Type:      "log",
		Timestamp: evt.LastTimestamp.Time.UTC().Format(time.RFC3339),
		Namespace: namespace,
		Pod:       evt.InvolvedObject.Name,
		Container: evt.InvolvedObject.Kind,
		Source:    fmt.Sprintf("%s/%s/%s", namespace, evt.InvolvedObject.Kind, evt.InvolvedObject.Name),
		Level:     lvl,
		Message:   fmt.Sprintf("[EVENT] Reason: %s | Message: %s", evt.Reason, evt.Message),
		Stream:    "stdout",
		Kind:      kind,
	})
}

func matchesEventResource(evt corev1.Event, name string) bool {
	if name == "" || strings.EqualFold(name, "all") || strings.EqualFold(name, "all-resources") {
		return true
	}
	cleanName := strings.ToLower(name)
	targetName := strings.ToLower(evt.InvolvedObject.Name)
	return strings.EqualFold(targetName, cleanName) || strings.Contains(targetName, cleanName)
}

