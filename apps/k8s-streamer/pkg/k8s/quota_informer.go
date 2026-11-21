package k8s

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// setupQuotaInformers attaches Informer event handlers for ResourceQuotas and LimitRanges
func (im *InformerManager) setupQuotaInformers() {
	quotaInformer := im.factory.Core().V1().ResourceQuotas().Informer()
	quotaInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if rq, ok := obj.(*corev1.ResourceQuota); ok {
				im.emitResourceQuotaDelta(rq)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if rq, ok := newObj.(*corev1.ResourceQuota); ok {
				im.emitResourceQuotaDelta(rq)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if rq, ok := obj.(*corev1.ResourceQuota); ok {
				im.emitResourceQuotaDeleted(rq)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if rq, ok := tombstone.Obj.(*corev1.ResourceQuota); ok {
					im.emitResourceQuotaDeleted(rq)
				}
			}
		},
	})

	limitRangeInformer := im.factory.Core().V1().LimitRanges().Informer()
	limitRangeInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if lr, ok := obj.(*corev1.LimitRange); ok {
				im.emitLimitRangeDelta(lr)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if lr, ok := newObj.(*corev1.LimitRange); ok {
				im.emitLimitRangeDelta(lr)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if lr, ok := obj.(*corev1.LimitRange); ok {
				im.emitLimitRangeDeleted(lr)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if lr, ok := tombstone.Obj.(*corev1.LimitRange); ok {
					im.emitLimitRangeDeleted(lr)
				}
			}
		},
	})
}

// extractResourceQuotaDelta parses ResourceQuota spec/status into a normalized delta
func (im *InformerManager) extractResourceQuotaDelta(rq *corev1.ResourceQuota) types.ResourceQuotaStatusDelta {
	hardMap := make(map[string]string)
	for k, v := range rq.Status.Hard {
		hardMap[string(k)] = v.String()
	}
	usedMap := make(map[string]string)
	for k, v := range rq.Status.Used {
		usedMap[string(k)] = v.String()
	}

	var cpuLimit, cpuUsed, cpuPct float64
	var memLimit, memUsed int64
	var memPct float64
	var podsLimit, podsUsed int32
	var podsPct float64

	// CPU parsing
	if hardCPU, ok := rq.Status.Hard[corev1.ResourceCPU]; ok {
		cpuLimit = hardCPU.AsApproximateFloat64()
	} else if hardReqCPU, ok := rq.Status.Hard[corev1.ResourceRequestsCPU]; ok {
		cpuLimit = hardReqCPU.AsApproximateFloat64()
	}
	if usedCPU, ok := rq.Status.Used[corev1.ResourceCPU]; ok {
		cpuUsed = usedCPU.AsApproximateFloat64()
	} else if usedReqCPU, ok := rq.Status.Used[corev1.ResourceRequestsCPU]; ok {
		cpuUsed = usedReqCPU.AsApproximateFloat64()
	}
	if cpuLimit > 0 {
		cpuPct = (cpuUsed / cpuLimit) * 100.0
	}

	// Memory parsing
	if hardMem, ok := rq.Status.Hard[corev1.ResourceMemory]; ok {
		memLimit = hardMem.Value()
	} else if hardReqMem, ok := rq.Status.Hard[corev1.ResourceRequestsMemory]; ok {
		memLimit = hardReqMem.Value()
	}
	if usedMem, ok := rq.Status.Used[corev1.ResourceMemory]; ok {
		memUsed = usedMem.Value()
	} else if usedReqMem, ok := rq.Status.Used[corev1.ResourceRequestsMemory]; ok {
		memUsed = usedReqMem.Value()
	}
	if memLimit > 0 {
		memPct = (float64(memUsed) / float64(memLimit)) * 100.0
	}

	// Pods parsing
	if hardPods, ok := rq.Status.Hard[corev1.ResourcePods]; ok {
		podsLimit = int32(hardPods.Value())
	}
	if usedPods, ok := rq.Status.Used[corev1.ResourcePods]; ok {
		podsUsed = int32(usedPods.Value())
	}
	if podsLimit > 0 {
		podsPct = (float64(podsUsed) / float64(podsLimit)) * 100.0
	}

	isBreached := cpuPct >= 100.0 || memPct >= 100.0 || podsPct >= 100.0
	isWarning := cpuPct >= 85.0 || memPct >= 85.0 || podsPct >= 85.0

	return types.ResourceQuotaStatusDelta{
		Name:                 rq.Name,
		Namespace:            rq.Namespace,
		Hard:                 hardMap,
		Used:                 usedMap,
		CPULimitCores:        cpuLimit,
		CPUUsedCores:         cpuUsed,
		CPUUtilizationPct:    cpuPct,
		MemoryLimitBytes:     memLimit,
		MemoryUsedBytes:      memUsed,
		MemoryUtilizationPct: memPct,
		PodsLimit:            podsLimit,
		PodsUsed:             podsUsed,
		PodsUtilizationPct:   podsPct,
		IsBreached:           isBreached,
		IsWarning:            isWarning,
		CreatedAt:            rq.CreationTimestamp.Time.UTC(),
	}
}

// extractLimitRangeDelta parses LimitRange constraints into a normalized delta
func (im *InformerManager) extractLimitRangeDelta(lr *corev1.LimitRange) types.LimitRangeStatusDelta {
	var itemDeltas []types.LimitRangeItemDelta

	for _, item := range lr.Spec.Limits {
		itemDeltas = append(itemDeltas, types.LimitRangeItemDelta{
			Type:                 string(item.Type),
			Min:                  resourceListToStringMap(item.Min),
			Max:                  resourceListToStringMap(item.Max),
			Default:              resourceListToStringMap(item.Default),
			DefaultRequest:       resourceListToStringMap(item.DefaultRequest),
			MaxLimitRequestRatio: resourceListToStringMap(item.MaxLimitRequestRatio),
		})
	}

	return types.LimitRangeStatusDelta{
		Name:      lr.Name,
		Namespace: lr.Namespace,
		Limits:    itemDeltas,
		CreatedAt: lr.CreationTimestamp.Time.UTC(),
	}
}

func resourceListToStringMap(rl corev1.ResourceList) map[string]string {
	if len(rl) == 0 {
		return nil
	}
	res := make(map[string]string, len(rl))
	for k, v := range rl {
		res[string(k)] = v.String()
	}
	return res
}

func (im *InformerManager) emitResourceQuotaDelta(rq *corev1.ResourceQuota) {
	delta := im.extractResourceQuotaDelta(rq)
	im.hub.BroadcastEvent(types.EventResourceQuotaMutated, im.clusterID, delta)
}

func (im *InformerManager) emitResourceQuotaDeleted(rq *corev1.ResourceQuota) {
	im.hub.BroadcastEvent(types.EventResourceQuotaDeleted, im.clusterID, map[string]string{
		"name":      rq.Name,
		"namespace": rq.Namespace,
	})
}

func (im *InformerManager) emitLimitRangeDelta(lr *corev1.LimitRange) {
	delta := im.extractLimitRangeDelta(lr)
	im.hub.BroadcastEvent(types.EventLimitRangeMutated, im.clusterID, delta)
}

func (im *InformerManager) emitLimitRangeDeleted(lr *corev1.LimitRange) {
	im.hub.BroadcastEvent(types.EventLimitRangeDeleted, im.clusterID, map[string]string{
		"name":      lr.Name,
		"namespace": lr.Namespace,
	})
}

// GetResourceQuotaSnapshot returns all cached ResourceQuotas for baseline hydration
func (im *InformerManager) GetResourceQuotaSnapshot() []types.ResourceQuotaStatusDelta {
	store := im.factory.Core().V1().ResourceQuotas().Informer().GetStore()
	var res []types.ResourceQuotaStatusDelta
	for _, item := range store.List() {
		if rq, ok := item.(*corev1.ResourceQuota); ok {
			res = append(res, im.extractResourceQuotaDelta(rq))
		}
	}
	return res
}

// GetLimitRangeSnapshot returns all cached LimitRanges for baseline hydration
func (im *InformerManager) GetLimitRangeSnapshot() []types.LimitRangeStatusDelta {
	store := im.factory.Core().V1().LimitRanges().Informer().GetStore()
	var res []types.LimitRangeStatusDelta
	for _, item := range store.List() {
		if lr, ok := item.(*corev1.LimitRange); ok {
			res = append(res, im.extractLimitRangeDelta(lr))
		}
	}
	return res
}
