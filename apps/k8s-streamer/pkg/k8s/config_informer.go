package k8s

import (
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// IsInternalSecret determines if a Secret is an internal Kubernetes token or infrastructure secret.
// By default, service account tokens and helm release payloads are filtered to prevent canvas noise.
func IsInternalSecret(sec *corev1.Secret) bool {
	if sec == nil {
		return true
	}
	if sec.Type == corev1.SecretTypeServiceAccountToken {
		return true
	}
	if strings.HasPrefix(sec.Name, "default-token-") {
		return true
	}
	if sec.Type == "helm.sh/release.v1" {
		return true
	}
	return false
}

// IsInternalConfigMap determines if a ConfigMap is an auto-generated internal system map.
func IsInternalConfigMap(cm *corev1.ConfigMap) bool {
	if cm == nil {
		return true
	}
	if cm.Name == "kube-root-ca.crt" {
		return true
	}
	if strings.HasPrefix(cm.Name, "kubeadm-config") || strings.HasPrefix(cm.Name, "kube-proxy") {
		return true
	}
	return false
}

// ExtractPodConfigReferences extracts all ConfigMaps and Secrets consumed by a Pod across volume mounts,
// individual environment variables (valueFrom), and bulk injections (envFrom).
func ExtractPodConfigReferences(pod *corev1.Pod) ([]types.PodConfigRef, []types.PodSecretRef) {
	if pod == nil {
		return nil, nil
	}

	cmMap := make(map[string]types.PodConfigRef)
	secMap := make(map[string]types.PodSecretRef)

	// 1. Process Volume Declarations
	volToCM := make(map[string]string)
	volToSec := make(map[string]string)

	for _, vol := range pod.Spec.Volumes {
		if vol.ConfigMap != nil && vol.ConfigMap.Name != "" {
			if vol.ConfigMap.Name != "kube-root-ca.crt" && !strings.HasPrefix(vol.ConfigMap.Name, "kubeadm-config") && !strings.HasPrefix(vol.ConfigMap.Name, "kube-proxy") {
				volToCM[vol.Name] = vol.ConfigMap.Name
			}
		}
		if vol.Secret != nil && vol.Secret.SecretName != "" {
			if !strings.HasPrefix(vol.Secret.SecretName, "default-token-") {
				volToSec[vol.Name] = vol.Secret.SecretName
			}
		}
		if vol.Projected != nil {
			for _, src := range vol.Projected.Sources {
				if src.ConfigMap != nil && src.ConfigMap.Name != "" && src.ConfigMap.Name != "kube-root-ca.crt" {
					volToCM[vol.Name] = src.ConfigMap.Name
				}
				if src.Secret != nil && src.Secret.Name != "" && !strings.HasPrefix(src.Secret.Name, "default-token-") {
					volToSec[vol.Name] = src.Secret.Name
				}
			}
		}
	}

	// 2. Map Volumes to Container Volume Mounts (MountPath)
	allContainers := append([]corev1.Container{}, pod.Spec.Containers...)
	allContainers = append(allContainers, pod.Spec.InitContainers...)

	for _, c := range allContainers {
		for _, vm := range c.VolumeMounts {
			if cmName, ok := volToCM[vm.Name]; ok {
				k := fmt.Sprintf("%s:volume:%s", cmName, vm.MountPath)
				cmMap[k] = types.PodConfigRef{
					Name:      cmName,
					Type:      "volume",
					MountPath: vm.MountPath,
				}
			}
			if secName, ok := volToSec[vm.Name]; ok {
				k := fmt.Sprintf("%s:volume:%s", secName, vm.MountPath)
				secMap[k] = types.PodSecretRef{
					Name:      secName,
					Type:      "volume",
					MountPath: vm.MountPath,
				}
			}
		}

		// 3. Process Container Environment Variables (valueFrom)
		for _, env := range c.Env {
			if env.ValueFrom == nil {
				continue
			}
			if env.ValueFrom.ConfigMapKeyRef != nil {
				ref := env.ValueFrom.ConfigMapKeyRef
				if ref.Name != "" && ref.Name != "kube-root-ca.crt" {
					k := fmt.Sprintf("%s:env:%s", ref.Name, ref.Key)
					cmMap[k] = types.PodConfigRef{
						Name:     ref.Name,
						Type:     "env",
						Key:      ref.Key,
						Optional: ref.Optional != nil && *ref.Optional,
					}
				}
			}
			if env.ValueFrom.SecretKeyRef != nil {
				ref := env.ValueFrom.SecretKeyRef
				if ref.Name != "" && !strings.HasPrefix(ref.Name, "default-token-") {
					k := fmt.Sprintf("%s:env:%s", ref.Name, ref.Key)
					secMap[k] = types.PodSecretRef{
						Name:     ref.Name,
						Type:     "env",
						Key:      ref.Key,
						Optional: ref.Optional != nil && *ref.Optional,
					}
				}
			}
		}

		// 4. Process Bulk Environment Variables (envFrom)
		for _, envFrom := range c.EnvFrom {
			if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name != "" && envFrom.ConfigMapRef.Name != "kube-root-ca.crt" {
				cmRef := envFrom.ConfigMapRef
				k := fmt.Sprintf("%s:envFrom", cmRef.Name)
				cmMap[k] = types.PodConfigRef{
					Name:     cmRef.Name,
					Type:     "envFrom",
					Optional: cmRef.Optional != nil && *cmRef.Optional,
				}
			}
			if envFrom.SecretRef != nil && envFrom.SecretRef.Name != "" && !strings.HasPrefix(envFrom.SecretRef.Name, "default-token-") {
				secRef := envFrom.SecretRef
				k := fmt.Sprintf("%s:envFrom", secRef.Name)
				secMap[k] = types.PodSecretRef{
					Name:     secRef.Name,
					Type:     "envFrom",
					Optional: secRef.Optional != nil && *secRef.Optional,
				}
			}
		}
	}

	// Unmounted Volume Declarations
	for volName, cmName := range volToCM {
		found := false
		for _, ref := range cmMap {
			if ref.Name == cmName {
				found = true
				break
			}
		}
		if !found {
			k := fmt.Sprintf("%s:volume:unmounted", cmName)
			cmMap[k] = types.PodConfigRef{
				Name: cmName,
				Type: "volume",
			}
		}
		_ = volName
	}

	for volName, secName := range volToSec {
		found := false
		for _, ref := range secMap {
			if ref.Name == secName {
				found = true
				break
			}
		}
		if !found {
			k := fmt.Sprintf("%s:volume:unmounted", secName)
			secMap[k] = types.PodSecretRef{
				Name: secName,
				Type: "volume",
			}
		}
		_ = volName
	}

	var cms []types.PodConfigRef
	for _, ref := range cmMap {
		cms = append(cms, ref)
	}
	sort.Slice(cms, func(i, j int) bool {
		return cms[i].Name < cms[j].Name
	})

	var secs []types.PodSecretRef
	for _, ref := range secMap {
		secs = append(secs, ref)
	}
	sort.Slice(secs, func(i, j int) bool {
		return secs[i].Name < secs[j].Name
	})

	return cms, secs
}

// setupConfigInformers registers event handlers for ConfigMaps and Secrets.
func (im *InformerManager) setupConfigInformers() {
	cmInformer := im.factory.Core().V1().ConfigMaps().Informer()
	cmInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if cm, ok := obj.(*corev1.ConfigMap); ok {
				if !IsInternalConfigMap(cm) {
					im.emitConfigMapDelta(cm)
				}
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if cm, ok := newObj.(*corev1.ConfigMap); ok {
				if !IsInternalConfigMap(cm) {
					im.emitConfigMapDelta(cm)
				}
			}
		},
		DeleteFunc: func(obj interface{}) {
			if cm, ok := obj.(*corev1.ConfigMap); ok {
				if !IsInternalConfigMap(cm) {
					im.emitConfigMapDeleted(cm)
				}
			}
		},
	})

	secInformer := im.factory.Core().V1().Secrets().Informer()
	secInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if sec, ok := obj.(*corev1.Secret); ok {
				if !IsInternalSecret(sec) {
					im.emitSecretDelta(sec)
				}
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if sec, ok := newObj.(*corev1.Secret); ok {
				if !IsInternalSecret(sec) {
					im.emitSecretDelta(sec)
				}
			}
		},
		DeleteFunc: func(obj interface{}) {
			if sec, ok := obj.(*corev1.Secret); ok {
				if !IsInternalSecret(sec) {
					im.emitSecretDeleted(sec)
				}
			}
		},
	})
}

func (im *InformerManager) extractConfigMapDelta(cm *corev1.ConfigMap) types.ConfigMapStatusDelta {
	var keys []string
	for k := range cm.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var binaryKeys []string
	for k := range cm.BinaryData {
		binaryKeys = append(binaryKeys, k)
	}
	sort.Strings(binaryKeys)

	dataCount := len(cm.Data) + len(cm.BinaryData)
	immutable := cm.Immutable != nil && *cm.Immutable

	age := time.Since(cm.CreationTimestamp.Time).Round(time.Second).String()

	return types.ConfigMapStatusDelta{
		Name:        cm.Name,
		Namespace:   cm.Namespace,
		Keys:        keys,
		BinaryKeys:  binaryKeys,
		DataCount:   dataCount,
		Immutable:   immutable,
		Labels:      cm.Labels,
		CreatedAt:   cm.CreationTimestamp.Time.UTC(),
		Age:         age,
	}
}

func (im *InformerManager) extractSecretDelta(sec *corev1.Secret) types.SecretStatusDelta {
	// STRICT SECURITY: We only extract key names, never raw data or stringData bytes
	var keys []string
	for k := range sec.Data {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	dataCount := len(sec.Data)
	immutable := sec.Immutable != nil && *sec.Immutable
	secType := string(sec.Type)
	if secType == "" {
		secType = "Opaque"
	}

	age := time.Since(sec.CreationTimestamp.Time).Round(time.Second).String()

	return types.SecretStatusDelta{
		Name:        sec.Name,
		Namespace:   sec.Namespace,
		Type:        secType,
		Keys:        keys,
		DataCount:   dataCount,
		Immutable:   immutable,
		Labels:      sec.Labels,
		CreatedAt:   sec.CreationTimestamp.Time.UTC(),
		Age:         age,
	}
}

func (im *InformerManager) emitConfigMapDelta(cm *corev1.ConfigMap) {
	delta := im.extractConfigMapDelta(cm)
	im.hub.BroadcastEvent(types.EventConfigMapMutated, im.clusterID, delta)
}

func (im *InformerManager) emitConfigMapDeleted(cm *corev1.ConfigMap) {
	im.hub.BroadcastEvent(types.EventConfigMapDeleted, im.clusterID, map[string]string{
		"name":      cm.Name,
		"namespace": cm.Namespace,
	})
}

func (im *InformerManager) emitSecretDelta(sec *corev1.Secret) {
	delta := im.extractSecretDelta(sec)
	im.hub.BroadcastEvent(types.EventSecretMutated, im.clusterID, delta)
}

func (im *InformerManager) emitSecretDeleted(sec *corev1.Secret) {
	im.hub.BroadcastEvent(types.EventSecretDeleted, im.clusterID, map[string]string{
		"name":      sec.Name,
		"namespace": sec.Namespace,
	})
}

func (im *InformerManager) getConfigMapsSnapshot() []types.ConfigMapStatusDelta {
	var result []types.ConfigMapStatusDelta
	cmList := im.factory.Core().V1().ConfigMaps().Informer().GetStore().List()
	for _, obj := range cmList {
		if cm, ok := obj.(*corev1.ConfigMap); ok {
			if !IsInternalConfigMap(cm) {
				result = append(result, im.extractConfigMapDelta(cm))
			}
		}
	}
	return result
}

func (im *InformerManager) getSecretsSnapshot() []types.SecretStatusDelta {
	var result []types.SecretStatusDelta
	secList := im.factory.Core().V1().Secrets().Informer().GetStore().List()
	for _, obj := range secList {
		if sec, ok := obj.(*corev1.Secret); ok {
			if !IsInternalSecret(sec) {
				result = append(result, im.extractSecretDelta(sec))
			}
		}
	}
	return result
}
