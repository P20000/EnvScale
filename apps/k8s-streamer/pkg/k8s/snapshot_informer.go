package k8s

import (
	"fmt"
	"log"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

var (
	// VolumeSnapshotGVR is the GroupVersionResource for snapshot.storage.k8s.io/v1 VolumeSnapshot
	VolumeSnapshotGVR = schema.GroupVersionResource{
		Group:    "snapshot.storage.k8s.io",
		Version:  "v1",
		Resource: "volumesnapshots",
	}

	// VolumeSnapshotContentGVR is the GroupVersionResource for snapshot.storage.k8s.io/v1 VolumeSnapshotContent
	VolumeSnapshotContentGVR = schema.GroupVersionResource{
		Group:    "snapshot.storage.k8s.io",
		Version:  "v1",
		Resource: "volumesnapshotcontents",
	}
)

// hasSnapshotCRD queries cluster discovery to verify if snapshot.storage.k8s.io is registered
func (im *InformerManager) hasSnapshotCRD() bool {
	if im.clientset == nil {
		return false
	}

	groups, err := im.clientset.Discovery().ServerGroups()
	if err != nil {
		return false
	}

	for _, g := range groups.Groups {
		if g.Name == "snapshot.storage.k8s.io" {
			return true
		}
	}
	return false
}

// setupSnapshotInformers initializes dynamic informers for VolumeSnapshot and VolumeSnapshotContent
func (im *InformerManager) setupSnapshotInformers() {
	if im.dynamicClient == nil {
		return
	}

	// Guard against clusters where external-snapshotter CRDs are not installed
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[K8s Informer] Warning: Snapshot informers disabled: %v", r)
		}
	}()

	if !im.hasSnapshotCRD() {
		log.Printf("[K8s Informer] snapshot.storage.k8s.io not detected on cluster %s; skipping snapshot informers", im.clusterID)
		return
	}

	dynFactory := dynamicinformer.NewDynamicSharedInformerFactory(im.dynamicClient, 30*time.Second)

	vsInformer := dynFactory.ForResource(VolumeSnapshotGVR).Informer()
	vsInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if u, ok := obj.(*unstructured.Unstructured); ok {
				im.emitVolumeSnapshotDelta(u)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if u, ok := newObj.(*unstructured.Unstructured); ok {
				im.emitVolumeSnapshotDelta(u)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if u, ok := obj.(*unstructured.Unstructured); ok {
				im.emitVolumeSnapshotDeleted(u)
			}
		},
	})

	vscInformer := dynFactory.ForResource(VolumeSnapshotContentGVR).Informer()
	vscInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if u, ok := obj.(*unstructured.Unstructured); ok {
				im.emitVolumeSnapshotContentDelta(u)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if u, ok := newObj.(*unstructured.Unstructured); ok {
				im.emitVolumeSnapshotContentDelta(u)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if u, ok := obj.(*unstructured.Unstructured); ok {
				im.emitVolumeSnapshotContentDeleted(u)
			}
		},
	})

	dynFactory.Start(im.stopCh)
	log.Printf("[K8s Informer] VolumeSnapshot dynamic informers active for cluster %s", im.clusterID)
}

// ExtractVolumeSnapshotDelta parses an unstructured VolumeSnapshot resource into normalized delta
func ExtractVolumeSnapshotDelta(u *unstructured.Unstructured) types.VolumeSnapshotDelta {
	pvcName, _, _ := unstructured.NestedString(u.Object, "spec", "source", "persistentVolumeClaimName")
	contentName, _, _ := unstructured.NestedString(u.Object, "status", "boundVolumeSnapshotContentName")
	snapClassName, _, _ := unstructured.NestedString(u.Object, "spec", "volumeSnapshotClassName")

	var readyToUse *bool
	if rtu, found, _ := unstructured.NestedBool(u.Object, "status", "readyToUse"); found {
		readyToUse = &rtu
	}

	restoreSize := ""
	if rs, found, _ := unstructured.NestedFieldNoCopy(u.Object, "status", "restoreSize"); found {
		restoreSize = fmt.Sprintf("%v", rs)
	}

	var snapCreationTime *time.Time
	if ctStr, found, _ := unstructured.NestedString(u.Object, "status", "creationTime"); found && ctStr != "" {
		if t, err := time.Parse(time.RFC3339, ctStr); err == nil {
			utc := t.UTC()
			snapCreationTime = &utc
		}
	}

	errMsg, _, _ := unstructured.NestedString(u.Object, "status", "error", "message")

	return types.VolumeSnapshotDelta{
		Name:                u.GetName(),
		Namespace:           u.GetNamespace(),
		ReadyToUse:          readyToUse,
		RestoreSize:         restoreSize,
		PVCName:             pvcName,
		SnapshotContentName: contentName,
		SnapshotClassName:   snapClassName,
		CreationTime:        snapCreationTime,
		Error:               errMsg,
		Labels:              u.GetLabels(),
		CreatedAt:           u.GetCreationTimestamp().Time.UTC(),
	}
}

// ExtractVolumeSnapshotContentDelta parses an unstructured VolumeSnapshotContent resource into normalized delta
func ExtractVolumeSnapshotContentDelta(u *unstructured.Unstructured) types.VolumeSnapshotContentDelta {
	driver, _, _ := unstructured.NestedString(u.Object, "spec", "driver")
	delPolicy, _, _ := unstructured.NestedString(u.Object, "spec", "deletionPolicy")
	snapClassName, _, _ := unstructured.NestedString(u.Object, "spec", "volumeSnapshotClassName")

	snapHandle, _, _ := unstructured.NestedString(u.Object, "status", "snapshotHandle")
	if snapHandle == "" {
		snapHandle, _, _ = unstructured.NestedString(u.Object, "spec", "source", "snapshotHandle")
	}

	vsName, _, _ := unstructured.NestedString(u.Object, "spec", "volumeSnapshotRef", "name")
	vsNs, _, _ := unstructured.NestedString(u.Object, "spec", "volumeSnapshotRef", "namespace")
	vsRef := ""
	if vsName != "" {
		if vsNs != "" {
			vsRef = fmt.Sprintf("%s/%s", vsNs, vsName)
		} else {
			vsRef = vsName
		}
	}

	var readyToUse *bool
	if rtu, found, _ := unstructured.NestedBool(u.Object, "status", "readyToUse"); found {
		readyToUse = &rtu
	}

	var restoreSize int64
	if rs, found, _ := unstructured.NestedInt64(u.Object, "status", "restoreSize"); found {
		restoreSize = rs
	}

	return types.VolumeSnapshotContentDelta{
		Name:              u.GetName(),
		SnapshotHandle:    snapHandle,
		Driver:            driver,
		DeletionPolicy:    delPolicy,
		SnapshotClassName: snapClassName,
		VolumeSnapshotRef: vsRef,
		ReadyToUse:        readyToUse,
		RestoreSize:       restoreSize,
		Labels:            u.GetLabels(),
		CreatedAt:         u.GetCreationTimestamp().Time.UTC(),
	}
}

func (im *InformerManager) emitVolumeSnapshotDelta(u *unstructured.Unstructured) {
	delta := ExtractVolumeSnapshotDelta(u)
	key := fmt.Sprintf("VolumeSnapshot/%s/%s", delta.Namespace, delta.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventVolumeSnapshotMutated, im.clusterID, delta)
}

func (im *InformerManager) emitVolumeSnapshotDeleted(u *unstructured.Unstructured) {
	key := fmt.Sprintf("VolumeSnapshot/%s/%s", u.GetNamespace(), u.GetName())
	im.dedup.Remove(key)
	im.hub.BroadcastEvent(types.EventVolumeSnapshotDeleted, im.clusterID, map[string]interface{}{
		"name":      u.GetName(),
		"namespace": u.GetNamespace(),
	})
}

func (im *InformerManager) emitVolumeSnapshotContentDelta(u *unstructured.Unstructured) {
	delta := ExtractVolumeSnapshotContentDelta(u)
	key := fmt.Sprintf("VolumeSnapshotContent/%s", delta.Name)
	if !im.dedup.ShouldEmit(key, delta) {
		return
	}
	im.hub.BroadcastEvent(types.EventVolumeSnapshotContentMutated, im.clusterID, delta)
}

func (im *InformerManager) emitVolumeSnapshotContentDeleted(u *unstructured.Unstructured) {
	key := fmt.Sprintf("VolumeSnapshotContent/%s", u.GetName())
	im.dedup.Remove(key)
	im.hub.BroadcastEvent(types.EventVolumeSnapshotContentDeleted, im.clusterID, map[string]interface{}{
		"name": u.GetName(),
	})
}
