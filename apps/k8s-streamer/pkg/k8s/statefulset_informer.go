package k8s

import (
	"fmt"
	"strings"

	"github.com/EnvScale/k8s-streamer/pkg/types"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
)

// extractStatefulSetDelta extracts the controller spec, observed status, volume claim templates, and headless service name
func (im *InformerManager) extractStatefulSetDelta(sts *appsv1.StatefulSet) types.StatefulSetStatusDelta {
	var replicas int32
	if sts.Spec.Replicas != nil {
		replicas = *sts.Spec.Replicas
	}

	var partition *int32
	updateStrategy := string(sts.Spec.UpdateStrategy.Type)
	if sts.Spec.UpdateStrategy.RollingUpdate != nil && sts.Spec.UpdateStrategy.RollingUpdate.Partition != nil {
		p := *sts.Spec.UpdateStrategy.RollingUpdate.Partition
		partition = &p
	}

	var vcts []types.VolumeClaimTemplateInfo
	for _, vct := range sts.Spec.VolumeClaimTemplates {
		storage := ""
		if req, ok := vct.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			storage = req.String()
		}
		var modes []string
		for _, m := range vct.Spec.AccessModes {
			modes = append(modes, string(m))
		}
		vcts = append(vcts, types.VolumeClaimTemplateInfo{
			Name:        vct.Name,
			Storage:     storage,
			AccessModes: strings.Join(modes, ", "),
		})
	}

	return types.StatefulSetStatusDelta{
		Name:                 sts.Name,
		Namespace:            sts.Namespace,
		Replicas:             replicas,
		ReadyReplicas:        sts.Status.ReadyReplicas,
		CurrentReplicas:      sts.Status.CurrentReplicas,
		UpdatedReplicas:      sts.Status.UpdatedReplicas,
		ServiceName:          sts.Spec.ServiceName,
		CurrentRevision:      sts.Status.CurrentRevision,
		UpdateRevision:       sts.Status.UpdateRevision,
		UpdateStrategy:       updateStrategy,
		Partition:            partition,
		VolumeClaimTemplates: vcts,
		Selector:             sts.Spec.Selector.MatchLabels,
		Labels:               sts.Labels,
		CreatedAt:            sts.CreationTimestamp.Time.UTC(),
	}
}

// emitStatefulSetDelta broadcasts StatefulSet status updates with deduplication
func (im *InformerManager) emitStatefulSetDelta(sts *appsv1.StatefulSet) {
	delta := im.extractStatefulSetDelta(sts)
	key := fmt.Sprintf("StatefulSet/%s/%s", sts.Namespace, sts.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventStatefulSetMutated, im.clusterID, delta)
}

// emitStatefulSetDeleted broadcasts StatefulSet removal events
func (im *InformerManager) emitStatefulSetDeleted(sts *appsv1.StatefulSet) {
	delta := im.extractStatefulSetDelta(sts)
	im.hub.BroadcastEvent(types.EventStatefulSetDeleted, im.clusterID, delta)
}
