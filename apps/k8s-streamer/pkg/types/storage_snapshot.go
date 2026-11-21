package types

import "time"

// VolumeSnapshotDelta encapsulates real-time snapshot.storage.k8s.io VolumeSnapshot state updates
type VolumeSnapshotDelta struct {
	Name                string            `json:"name"`
	Namespace           string            `json:"namespace"`
	ReadyToUse          *bool             `json:"readyToUse,omitempty"`
	RestoreSize         string            `json:"restoreSize,omitempty"`
	PVCName             string            `json:"pvcName,omitempty"`
	SnapshotContentName string            `json:"snapshotContentName,omitempty"`
	SnapshotClassName   string            `json:"snapshotClassName,omitempty"`
	CreationTime        *time.Time        `json:"creationTime,omitempty"`
	Error               string            `json:"error,omitempty"`
	Labels              map[string]string `json:"labels,omitempty"`
	CreatedAt           time.Time         `json:"createdAt"`
}

// VolumeSnapshotContentDelta encapsulates cluster-scoped VolumeSnapshotContent state updates
type VolumeSnapshotContentDelta struct {
	Name              string            `json:"name"`
	SnapshotHandle    string            `json:"snapshotHandle,omitempty"`
	Driver            string            `json:"driver,omitempty"`
	DeletionPolicy    string            `json:"deletionPolicy,omitempty"`
	SnapshotClassName string            `json:"snapshotClassName,omitempty"`
	VolumeSnapshotRef string            `json:"volumeSnapshotRef,omitempty"` // "namespace/name"
	ReadyToUse        *bool             `json:"readyToUse,omitempty"`
	RestoreSize       int64             `json:"restoreSize,omitempty"`
	Labels            map[string]string `json:"labels,omitempty"`
	CreatedAt         time.Time         `json:"createdAt"`
}

// PVCDataSourceInfo encapsulates dataSource reference when a PVC is restored from a VolumeSnapshot
type PVCDataSourceInfo struct {
	APIGroup string `json:"apiGroup,omitempty"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
}
