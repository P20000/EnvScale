package k8s

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestExtractPodVolumeClaims_StandalonePod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-pod",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			Volumes: []corev1.Volume{
				{
					Name: "config-vol",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{},
					},
				},
				{
					Name: "storage-vol",
					VolumeSource: corev1.VolumeSource{
						PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
							ClaimName: "web-pvc",
						},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name: "nginx",
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "storage-vol",
							MountPath: "/var/www/html",
							ReadOnly:  false,
						},
					},
				},
			},
		},
	}

	mounts := ExtractPodVolumeClaims(pod)
	if len(mounts) != 1 {
		t.Fatalf("expected 1 PVC volume mount, got %d", len(mounts))
	}

	if mounts[0].PVCName != "web-pvc" {
		t.Errorf("expected PVCName 'web-pvc', got '%s'", mounts[0].PVCName)
	}
	if mounts[0].MountPath != "/var/www/html" {
		t.Errorf("expected MountPath '/var/www/html', got '%s'", mounts[0].MountPath)
	}
	if mounts[0].ReadOnly {
		t.Errorf("expected ReadOnly false, got true")
	}
}

func TestExtractPodVolumeClaims_StatefulSetVolumeClaimTemplate(t *testing.T) {
	// Kubelet renders the dynamic PVC on the pod instance for StatefulSets
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "postgres-0",
			Namespace: "db",
			Labels: map[string]string{
				"app": "postgres",
			},
		},
		Spec: corev1.PodSpec{
			Volumes: []corev1.Volume{
				{
					Name: "postgres-data",
					VolumeSource: corev1.VolumeSource{
						PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
							ClaimName: "postgres-data-postgres-0",
						},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name: "postgres",
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "postgres-data",
							MountPath: "/var/lib/postgresql/data",
						},
					},
				},
			},
		},
	}

	mounts := ExtractPodVolumeClaims(pod)
	if len(mounts) != 1 {
		t.Fatalf("expected 1 PVC mount for statefulset pod, got %d", len(mounts))
	}

	if mounts[0].PVCName != "postgres-data-postgres-0" {
		t.Errorf("expected dynamic PVC 'postgres-data-postgres-0', got '%s'", mounts[0].PVCName)
	}
	if mounts[0].MountPath != "/var/lib/postgresql/data" {
		t.Errorf("expected MountPath '/var/lib/postgresql/data', got '%s'", mounts[0].MountPath)
	}
}

func TestExtractPVCDelta_And_PVDelta(t *testing.T) {
	hub := websocket.NewHub()
	im := &InformerManager{
		hub:       hub,
		clusterID: "test-cluster",
		dedup:     NewDedupCache(),
	}

	sc := "local-path"
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "my-pvc",
			Namespace: "default",
			Labels:    map[string]string{"env": "test"},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			VolumeName:       "pv-vol-123",
			StorageClassName: &sc,
			AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: resource.MustParse("5Gi"),
				},
			},
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
			Capacity: corev1.ResourceList{
				corev1.ResourceStorage: resource.MustParse("5Gi"),
			},
		},
	}

	deltaPVC := im.extractPVCDelta(pvc)
	if deltaPVC.Name != "my-pvc" || deltaPVC.Phase != "Bound" {
		t.Errorf("unexpected PVC delta: %+v", deltaPVC)
	}
	if deltaPVC.StorageClassName != "local-path" {
		t.Errorf("expected StorageClassName 'local-path', got '%s'", deltaPVC.StorageClassName)
	}
	if deltaPVC.VolumeName != "pv-vol-123" {
		t.Errorf("expected VolumeName 'pv-vol-123', got '%s'", deltaPVC.VolumeName)
	}

	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name: "pv-vol-123",
		},
		Spec: corev1.PersistentVolumeSpec{
			StorageClassName:              "local-path",
			PersistentVolumeReclaimPolicy: corev1.PersistentVolumeReclaimDelete,
			AccessModes:                   []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Capacity: corev1.ResourceList{
				corev1.ResourceStorage: resource.MustParse("5Gi"),
			},
			PersistentVolumeSource: corev1.PersistentVolumeSource{
				HostPath: &corev1.HostPathVolumeSource{
					Path: "/tmp/hostpath-data",
				},
			},
			ClaimRef: &corev1.ObjectReference{
				Name:      "my-pvc",
				Namespace: "default",
			},
		},
		Status: corev1.PersistentVolumeStatus{
			Phase: corev1.VolumeBound,
		},
	}

	deltaPV := im.extractPVDelta(pv)
	if deltaPV.Name != "pv-vol-123" || deltaPV.Phase != "Bound" {
		t.Errorf("unexpected PV delta: %+v", deltaPV)
	}
	if deltaPV.VolumeSourceType != "HostPath" {
		t.Errorf("expected VolumeSourceType HostPath, got %s", deltaPV.VolumeSourceType)
	}
	if deltaPV.ReclaimPolicy != "Delete" {
		t.Errorf("expected ReclaimPolicy Delete, got %s", deltaPV.ReclaimPolicy)
	}
	if deltaPV.ClaimRefName != "my-pvc" {
		t.Errorf("expected ClaimRefName 'my-pvc', got '%s'", deltaPV.ClaimRefName)
	}
}
