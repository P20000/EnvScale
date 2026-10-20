package k8s

import (
	"fmt"
	"log"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// ExtractPodVolumeClaims parses pod volume mounts and extracts effective rendered PVC names.
// Explicitly handles standalone Pods and StatefulSet dynamic volumeClaimTemplates (e.g. data-db-0).
func ExtractPodVolumeClaims(pod *corev1.Pod) []types.PodVolumeMountInfo {
	if pod == nil || len(pod.Spec.Volumes) == 0 {
		return nil
	}

	pvcMap := make(map[string]string) // volumeName -> pvcName
	for _, vol := range pod.Spec.Volumes {
		if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName != "" {
			pvcMap[vol.Name] = vol.PersistentVolumeClaim.ClaimName
		}
	}

	if len(pvcMap) == 0 {
		return nil
	}

	var results []types.PodVolumeMountInfo
	seen := make(map[string]bool)

	// Search standard containers and init containers for corresponding mount paths
	allContainers := append([]corev1.Container{}, pod.Spec.Containers...)
	allContainers = append(allContainers, pod.Spec.InitContainers...)

	for _, container := range allContainers {
		for _, vm := range container.VolumeMounts {
			if claimName, ok := pvcMap[vm.Name]; ok {
				uniqueKey := fmt.Sprintf("%s:%s", claimName, vm.MountPath)
				if !seen[uniqueKey] {
					seen[uniqueKey] = true
					results = append(results, types.PodVolumeMountInfo{
						Name:      vm.Name,
						PVCName:   claimName,
						MountPath: vm.MountPath,
						ReadOnly:  vm.ReadOnly,
					})
				}
			}
		}
	}

	// Capture any unmounted PVC declarations
	for volName, claimName := range pvcMap {
		var found bool
		for _, r := range results {
			if r.Name == volName {
				found = true
				break
			}
		}
		if !found {
			results = append(results, types.PodVolumeMountInfo{
				Name:    volName,
				PVCName: claimName,
			})
		}
	}

	return results
}

// setupStorageInformers initializes informers for PersistentVolumeClaims and PersistentVolumes.
func (im *InformerManager) setupStorageInformers() {
	pvcInformer := im.factory.Core().V1().PersistentVolumeClaims().Informer()
	pvcInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if pvc, ok := obj.(*corev1.PersistentVolumeClaim); ok {
				im.emitPVCDelta(pvc)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if pvc, ok := newObj.(*corev1.PersistentVolumeClaim); ok {
				im.emitPVCDelta(pvc)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if pvc, ok := obj.(*corev1.PersistentVolumeClaim); ok {
				im.emitPVCDeleted(pvc)
			}
		},
	})

	// Wrap PV informer defensively to avoid panics on restricted namespace RBAC clusters
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[K8s Informer] Warning: Cluster-scoped PersistentVolume informer unavailable: %v", r)
		}
	}()

	pvInformer := im.factory.Core().V1().PersistentVolumes().Informer()
	pvInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if pv, ok := obj.(*corev1.PersistentVolume); ok {
				im.emitPVDelta(pv)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if pv, ok := newObj.(*corev1.PersistentVolume); ok {
				im.emitPVDelta(pv)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if pv, ok := obj.(*corev1.PersistentVolume); ok {
				im.emitPVDeleted(pv)
			}
		},
	})
}

// extractPVCDelta constructs a normalized delta from a PersistentVolumeClaim.
func (im *InformerManager) extractPVCDelta(pvc *corev1.PersistentVolumeClaim) types.PVCStatusDelta {
	phase := string(pvc.Status.Phase)
	if phase == "" {
		phase = "Pending"
	}

	var storageClass string
	if pvc.Spec.StorageClassName != nil {
		storageClass = *pvc.Spec.StorageClassName
	}

	var requestedSize string
	if req, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
		requestedSize = req.String()
	}

	var capacity string
	if cap, ok := pvc.Status.Capacity[corev1.ResourceStorage]; ok {
		capacity = cap.String()
	}

	var accessModes []string
	for _, mode := range pvc.Spec.AccessModes {
		accessModes = append(accessModes, string(mode))
	}

	var volumeMode string
	if pvc.Spec.VolumeMode != nil {
		volumeMode = string(*pvc.Spec.VolumeMode)
	}

	return types.PVCStatusDelta{
		Name:             pvc.Name,
		Namespace:        pvc.Namespace,
		Phase:            phase,
		VolumeName:       pvc.Spec.VolumeName,
		StorageClassName: storageClass,
		RequestedSize:    requestedSize,
		Capacity:         capacity,
		AccessModes:      accessModes,
		VolumeMode:       volumeMode,
		Labels:           pvc.Labels,
		CreatedAt:        pvc.CreationTimestamp.Time.UTC(),
	}
}

// extractPVDelta constructs a normalized delta from a PersistentVolume.
func (im *InformerManager) extractPVDelta(pv *corev1.PersistentVolume) types.PVStatusDelta {
	phase := string(pv.Status.Phase)
	if phase == "" {
		phase = "Available"
	}

	var capacity string
	if cap, ok := pv.Spec.Capacity[corev1.ResourceStorage]; ok {
		capacity = cap.String()
	}

	var accessModes []string
	for _, mode := range pv.Spec.AccessModes {
		accessModes = append(accessModes, string(mode))
	}

	var claimRefName, claimRefNs string
	if pv.Spec.ClaimRef != nil {
		claimRefName = pv.Spec.ClaimRef.Name
		claimRefNs = pv.Spec.ClaimRef.Namespace
	}

	volumeSourceType := "Unknown"
	switch {
	case pv.Spec.HostPath != nil:
		volumeSourceType = "HostPath"
	case pv.Spec.CSI != nil:
		volumeSourceType = fmt.Sprintf("CSI (%s)", pv.Spec.CSI.Driver)
	case pv.Spec.NFS != nil:
		volumeSourceType = "NFS"
	case pv.Spec.Local != nil:
		volumeSourceType = "Local"
	case pv.Spec.AWSElasticBlockStore != nil:
		volumeSourceType = "AWS-EBS"
	}

	return types.PVStatusDelta{
		Name:             pv.Name,
		Phase:            phase,
		Capacity:         capacity,
		AccessModes:      accessModes,
		ReclaimPolicy:    string(pv.Spec.PersistentVolumeReclaimPolicy),
		StorageClassName: pv.Spec.StorageClassName,
		ClaimRefName:     claimRefName,
		ClaimRefNs:       claimRefNs,
		VolumeSourceType: volumeSourceType,
		Labels:           pv.Labels,
		CreatedAt:        pv.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) emitPVCDelta(pvc *corev1.PersistentVolumeClaim) {
	delta := im.extractPVCDelta(pvc)
	key := fmt.Sprintf("PVC/%s/%s", pvc.Namespace, pvc.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventPVCMutated, im.clusterID, delta)
}

func (im *InformerManager) emitPVCDeleted(pvc *corev1.PersistentVolumeClaim) {
	key := fmt.Sprintf("PVC/%s/%s", pvc.Namespace, pvc.Name)
	im.dedup.Remove(key)
	im.hub.BroadcastEvent(types.EventPVCDeleted, im.clusterID, map[string]interface{}{
		"name":      pvc.Name,
		"namespace": pvc.Namespace,
	})
}

func (im *InformerManager) emitPVDelta(pv *corev1.PersistentVolume) {
	delta := im.extractPVDelta(pv)
	key := fmt.Sprintf("PV/%s", pv.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventPVMutated, im.clusterID, delta)
}

func (im *InformerManager) emitPVDeleted(pv *corev1.PersistentVolume) {
	key := fmt.Sprintf("PV/%s", pv.Name)
	im.dedup.Remove(key)
	im.hub.BroadcastEvent(types.EventPVDeleted, im.clusterID, map[string]interface{}{
		"name": pv.Name,
	})
}

// getPVCSnapshot returns all PersistentVolumeClaims currently in the informer cache.
func (im *InformerManager) getPVCSnapshot() []types.PVCStatusDelta {
	var pvcs []types.PVCStatusDelta
	pvcList := im.factory.Core().V1().PersistentVolumeClaims().Informer().GetStore().List()
	for _, obj := range pvcList {
		if pvc, ok := obj.(*corev1.PersistentVolumeClaim); ok {
			pvcs = append(pvcs, im.extractPVCDelta(pvc))
		}
	}
	return pvcs
}

// getPVSnapshot returns all PersistentVolumes currently in the informer cache.
func (im *InformerManager) getPVSnapshot() []types.PVStatusDelta {
	var pvs []types.PVStatusDelta
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[K8s Informer] Warning: Failed to query PV snapshot: %v", r)
		}
	}()

	pvList := im.factory.Core().V1().PersistentVolumes().Informer().GetStore().List()
	for _, obj := range pvList {
		if pv, ok := obj.(*corev1.PersistentVolume); ok {
			pvs = append(pvs, im.extractPVDelta(pv))
		}
	}
	return pvs
}
