package k8s

import (
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

func TestExtractVolumeSnapshotDelta(t *testing.T) {
	u := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "snapshot.storage.k8s.io/v1",
			"kind":       "VolumeSnapshot",
			"metadata": map[string]interface{}{
				"name":              "postgres-data-backup",
				"namespace":         "production",
				"creationTimestamp": "2026-10-30T10:00:00Z",
				"labels": map[string]interface{}{
					"app": "postgres",
				},
			},
			"spec": map[string]interface{}{
				"volumeSnapshotClassName": "csi-aws-vsc",
				"source": map[string]interface{}{
					"persistentVolumeClaimName": "postgres-pvc-data",
				},
			},
			"status": map[string]interface{}{
				"readyToUse":                     true,
				"restoreSize":                    "10Gi",
				"boundVolumeSnapshotContentName": "snapcontent-c2152865-c38a-40a2",
				"creationTime":                   "2026-10-30T10:05:00Z",
			},
		},
	}

	delta := ExtractVolumeSnapshotDelta(u)

	if delta.Name != "postgres-data-backup" {
		t.Fatalf("expected name 'postgres-data-backup', got '%s'", delta.Name)
	}
	if delta.Namespace != "production" {
		t.Fatalf("expected namespace 'production', got '%s'", delta.Namespace)
	}
	if delta.PVCName != "postgres-pvc-data" {
		t.Fatalf("expected pvcName 'postgres-pvc-data', got '%s'", delta.PVCName)
	}
	if delta.SnapshotClassName != "csi-aws-vsc" {
		t.Fatalf("expected snapshotClassName 'csi-aws-vsc', got '%s'", delta.SnapshotClassName)
	}
	if delta.SnapshotContentName != "snapcontent-c2152865-c38a-40a2" {
		t.Fatalf("expected bound content 'snapcontent-c2152865-c38a-40a2', got '%s'", delta.SnapshotContentName)
	}
	if delta.ReadyToUse == nil || !*delta.ReadyToUse {
		t.Fatalf("expected readyToUse true, got %v", delta.ReadyToUse)
	}
	if delta.RestoreSize != "10Gi" {
		t.Fatalf("expected restoreSize '10Gi', got '%s'", delta.RestoreSize)
	}
	if delta.CreationTime == nil {
		t.Fatalf("expected creationTime to be parsed, got nil")
	}
}

func TestExtractVolumeSnapshotContentDelta(t *testing.T) {
	u := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "snapshot.storage.k8s.io/v1",
			"kind":       "VolumeSnapshotContent",
			"metadata": map[string]interface{}{
				"name":              "snapcontent-c2152865-c38a-40a2",
				"creationTimestamp": "2026-10-30T10:01:00Z",
			},
			"spec": map[string]interface{}{
				"driver":                  "ebs.csi.aws.com",
				"deletionPolicy":          "Delete",
				"volumeSnapshotClassName": "csi-aws-vsc",
				"source": map[string]interface{}{
					"snapshotHandle": "snap-0123456789abcdef0",
				},
				"volumeSnapshotRef": map[string]interface{}{
					"name":      "postgres-data-backup",
					"namespace": "production",
				},
			},
			"status": map[string]interface{}{
				"readyToUse":  true,
				"restoreSize": int64(10737418240),
			},
		},
	}

	delta := ExtractVolumeSnapshotContentDelta(u)

	if delta.Name != "snapcontent-c2152865-c38a-40a2" {
		t.Fatalf("expected name 'snapcontent-c2152865-c38a-40a2', got '%s'", delta.Name)
	}
	if delta.Driver != "ebs.csi.aws.com" {
		t.Fatalf("expected driver 'ebs.csi.aws.com', got '%s'", delta.Driver)
	}
	if delta.SnapshotHandle != "snap-0123456789abcdef0" {
		t.Fatalf("expected snapshotHandle 'snap-0123456789abcdef0', got '%s'", delta.SnapshotHandle)
	}
	if delta.DeletionPolicy != "Delete" {
		t.Fatalf("expected deletionPolicy 'Delete', got '%s'", delta.DeletionPolicy)
	}
	if delta.VolumeSnapshotRef != "production/postgres-data-backup" {
		t.Fatalf("expected volumeSnapshotRef 'production/postgres-data-backup', got '%s'", delta.VolumeSnapshotRef)
	}
	if delta.ReadyToUse == nil || !*delta.ReadyToUse {
		t.Fatalf("expected readyToUse true, got %v", delta.ReadyToUse)
	}
	if delta.RestoreSize != 10737418240 {
		t.Fatalf("expected restoreSize 10737418240, got %d", delta.RestoreSize)
	}
}

func TestVolumeSnapshotDelta_InformerManagerNoPanic(t *testing.T) {
	im := &InformerManager{
		clusterID: "test-cluster",
		stopCh:    make(chan struct{}),
	}
	// Calling setupSnapshotInformers without dynamicClient or discovery should return cleanly without panicking
	im.setupSnapshotInformers()
}

func TestPVCDataSourceInfo(t *testing.T) {
	pvcDelta := types.PVCStatusDelta{
		Name:      "cloned-pvc",
		Namespace: "default",
		Phase:     "Bound",
		DataSource: &types.PVCDataSourceInfo{
			APIGroup: "snapshot.storage.k8s.io",
			Kind:     "VolumeSnapshot",
			Name:     "postgres-data-backup",
		},
		CreatedAt: time.Now(),
	}

	if pvcDelta.DataSource == nil {
		t.Fatalf("expected non-nil dataSource")
	}
	if pvcDelta.DataSource.Kind != "VolumeSnapshot" {
		t.Fatalf("expected dataSource kind 'VolumeSnapshot', got '%s'", pvcDelta.DataSource.Kind)
	}
	if pvcDelta.DataSource.Name != "postgres-data-backup" {
		t.Fatalf("expected dataSource name 'postgres-data-backup', got '%s'", pvcDelta.DataSource.Name)
	}
}

// silence unused import warning
var _ = metav1.Now
