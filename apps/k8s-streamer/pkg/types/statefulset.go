package types

import "time"

// VolumeClaimTemplateInfo describes a PVC template defined on a StatefulSet
type VolumeClaimTemplateInfo struct {
	Name        string `json:"name"`
	Storage     string `json:"storage,omitempty"`
	AccessModes string `json:"accessModes,omitempty"`
}

// StatefulSetStatusDelta encapsulates StatefulSet state updates, controller status, and identity specs
type StatefulSetStatusDelta struct {
	Name                 string                    `json:"name"`
	Namespace            string                    `json:"namespace"`
	Replicas             int32                     `json:"replicas"`
	ReadyReplicas        int32                     `json:"readyReplicas"`
	CurrentReplicas      int32                     `json:"currentReplicas"`
	UpdatedReplicas      int32                     `json:"updatedReplicas"`
	ServiceName          string                    `json:"serviceName,omitempty"`
	CurrentRevision      string                    `json:"currentRevision,omitempty"`
	UpdateRevision       string                    `json:"updateRevision,omitempty"`
	UpdateStrategy       string                    `json:"updateStrategy,omitempty"`
	Partition            *int32                    `json:"partition,omitempty"`
	VolumeClaimTemplates []VolumeClaimTemplateInfo `json:"volumeClaimTemplates,omitempty"`
	Selector             map[string]string         `json:"selector"`
	Labels               map[string]string         `json:"labels"`
	CreatedAt            time.Time                 `json:"createdAt,omitempty"`
}
