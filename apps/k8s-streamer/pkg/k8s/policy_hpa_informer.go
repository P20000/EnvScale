package k8s

import (
	"fmt"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// setupPolicyHPAInformers attaches Informer event handlers for HPA and NetworkPolicy
func (im *InformerManager) setupPolicyHPAInformers() {
	hpaInformer := im.factory.Autoscaling().V2().HorizontalPodAutoscalers().Informer()
	hpaInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if hpa, ok := obj.(*autoscalingv2.HorizontalPodAutoscaler); ok {
				im.emitHPADelta(hpa)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if hpa, ok := newObj.(*autoscalingv2.HorizontalPodAutoscaler); ok {
				im.emitHPADelta(hpa)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if hpa, ok := obj.(*autoscalingv2.HorizontalPodAutoscaler); ok {
				im.emitHPADeleted(hpa)
			}
		},
	})

	netpolInformer := im.factory.Networking().V1().NetworkPolicies().Informer()
	netpolInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if np, ok := obj.(*networkingv1.NetworkPolicy); ok {
				im.emitNetworkPolicyDelta(np)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if np, ok := newObj.(*networkingv1.NetworkPolicy); ok {
				im.emitNetworkPolicyDelta(np)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if np, ok := obj.(*networkingv1.NetworkPolicy); ok {
				im.emitNetworkPolicyDeleted(np)
			}
		},
	})
}

func (im *InformerManager) extractHPADelta(hpa *autoscalingv2.HorizontalPodAutoscaler) types.HPAStatusDelta {
	var minReplicas int32 = 1
	if hpa.Spec.MinReplicas != nil {
		minReplicas = *hpa.Spec.MinReplicas
	}

	var currentCPU *int32
	var targetCPU *int32

	for _, m := range hpa.Spec.Metrics {
		if m.Type == autoscalingv2.ResourceMetricSourceType && m.Resource != nil && m.Resource.Name == corev1.ResourceCPU {
			if m.Resource.Target.AverageUtilization != nil {
				targetCPU = m.Resource.Target.AverageUtilization
			}
		}
	}

	for _, cm := range hpa.Status.CurrentMetrics {
		if cm.Type == autoscalingv2.ResourceMetricSourceType && cm.Resource != nil && cm.Resource.Name == corev1.ResourceCPU {
			if cm.Resource.Current.AverageUtilization != nil {
				currentCPU = cm.Resource.Current.AverageUtilization
			}
		}
	}

	delta := types.HPAStatusDelta{
		Name:            hpa.Name,
		Namespace:       hpa.Namespace,
		TargetRefKind:   hpa.Spec.ScaleTargetRef.Kind,
		TargetRefName:   hpa.Spec.ScaleTargetRef.Name,
		MinReplicas:     minReplicas,
		MaxReplicas:     hpa.Spec.MaxReplicas,
		CurrentReplicas: hpa.Status.CurrentReplicas,
		DesiredReplicas: hpa.Status.DesiredReplicas,
		CurrentCPUUtil:  currentCPU,
		TargetCPUUtil:   targetCPU,
	}

	if hpa.Status.LastScaleTime != nil {
		t := hpa.Status.LastScaleTime.Time.UTC()
		delta.LastScaleTime = &t
	}

	return delta
}

func (im *InformerManager) emitHPADelta(hpa *autoscalingv2.HorizontalPodAutoscaler) {
	delta := im.extractHPADelta(hpa)
	im.hub.BroadcastEvent(types.EventHPAMutated, im.clusterID, delta)
}

func (im *InformerManager) emitHPADeleted(hpa *autoscalingv2.HorizontalPodAutoscaler) {
	im.hub.BroadcastEvent(types.EventHPADeleted, im.clusterID, map[string]string{
		"name":      hpa.Name,
		"namespace": hpa.Namespace,
	})
}

func (im *InformerManager) extractNetworkPolicyDelta(np *networkingv1.NetworkPolicy) types.NetworkPolicyStatusDelta {
	var policyTypes []string
	for _, pt := range np.Spec.PolicyTypes {
		policyTypes = append(policyTypes, string(pt))
	}

	var ingressRules []string
	for _, ing := range np.Spec.Ingress {
		for _, port := range ing.Ports {
			proto := "TCP"
			if port.Protocol != nil {
				proto = string(*port.Protocol)
			}
			portVal := ""
			if port.Port != nil {
				portVal = port.Port.String()
			}
			ingressRules = append(ingressRules, fmt.Sprintf("%s:%s", proto, portVal))
		}
		for _, from := range ing.From {
			if from.PodSelector != nil {
				for k, v := range from.PodSelector.MatchLabels {
					ingressRules = append(ingressRules, fmt.Sprintf("from:pod(%s=%s)", k, v))
				}
			}
			if from.NamespaceSelector != nil {
				ingressRules = append(ingressRules, "from:all-namespaces")
			}
		}
	}

	return types.NetworkPolicyStatusDelta{
		Name:         np.Name,
		Namespace:    np.Namespace,
		PodSelector:  np.Spec.PodSelector.MatchLabels,
		PolicyTypes:  policyTypes,
		IngressRules: ingressRules,
	}
}

func (im *InformerManager) emitNetworkPolicyDelta(np *networkingv1.NetworkPolicy) {
	delta := im.extractNetworkPolicyDelta(np)
	im.hub.BroadcastEvent(types.EventNetworkPolicyMutated, im.clusterID, delta)
}

func (im *InformerManager) emitNetworkPolicyDeleted(np *networkingv1.NetworkPolicy) {
	im.hub.BroadcastEvent(types.EventNetworkPolicyDeleted, im.clusterID, map[string]string{
		"name":      np.Name,
		"namespace": np.Namespace,
	})
}

// GetHPASnapshot returns the current cached state of all HorizontalPodAutoscalers
func (im *InformerManager) GetHPASnapshot() []types.HPAStatusDelta {
	hpaList := im.factory.Autoscaling().V2().HorizontalPodAutoscalers().Informer().GetStore().List()
	var hpas []types.HPAStatusDelta
	for _, obj := range hpaList {
		if hpa, ok := obj.(*autoscalingv2.HorizontalPodAutoscaler); ok {
			hpas = append(hpas, im.extractHPADelta(hpa))
		}
	}
	return hpas
}

// GetNetworkPolicySnapshot returns the current cached state of all NetworkPolicies
func (im *InformerManager) GetNetworkPolicySnapshot() []types.NetworkPolicyStatusDelta {
	npList := im.factory.Networking().V1().NetworkPolicies().Informer().GetStore().List()
	var nps []types.NetworkPolicyStatusDelta
	for _, obj := range npList {
		if np, ok := obj.(*networkingv1.NetworkPolicy); ok {
			nps = append(nps, im.extractNetworkPolicyDelta(np))
		}
	}
	return nps
}

// ExtractPodProbes inspects a pod's first primary container and formats probe specifications
func ExtractPodProbes(pod *corev1.Pod) (liveness *types.ProbeSpecInfo, readiness *types.ProbeSpecInfo) {
	if pod == nil || len(pod.Spec.Containers) == 0 {
		return nil, nil
	}

	c := pod.Spec.Containers[0]
	if c.LivenessProbe != nil {
		liveness = convertProbe(c.LivenessProbe)
	}
	if c.ReadinessProbe != nil {
		readiness = convertProbe(c.ReadinessProbe)
	}
	return liveness, readiness
}

func convertProbe(p *corev1.Probe) *types.ProbeSpecInfo {
	if p == nil {
		return nil
	}

	info := &types.ProbeSpecInfo{
		InitialDelaySeconds: p.InitialDelaySeconds,
		PeriodSeconds:       p.PeriodSeconds,
		TimeoutSeconds:      p.TimeoutSeconds,
		FailureThreshold:    p.FailureThreshold,
	}

	if p.HTTPGet != nil {
		info.Type = "http"
		info.Path = p.HTTPGet.Path
		info.Port = p.HTTPGet.Port.IntVal
	} else if p.TCPSocket != nil {
		info.Type = "tcp"
		info.Port = p.TCPSocket.Port.IntVal
	} else if p.Exec != nil {
		info.Type = "exec"
	}

	return info
}
