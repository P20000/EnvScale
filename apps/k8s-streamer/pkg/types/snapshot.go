package types

// ClusterSnapshot encapsulates the complete baseline state of a cluster for UI hydration
type ClusterSnapshot struct {
	Pods            []PodStatusDelta           `json:"pods"`
	Nodes           []NodeStatusDelta          `json:"nodes"`
	Services        []ServiceStatusDelta       `json:"services"`
	Deployments     []DeploymentStatusDelta    `json:"deployments"`
	ReplicaSets     []ReplicaSetStatusDelta    `json:"replicaSets"`
	StatefulSets    []StatefulSetStatusDelta   `json:"statefulSets"`
	DaemonSets      []DaemonSetStatusDelta     `json:"daemonSets"`
	Ingresses       []IngressStatusDelta       `json:"ingresses"`
	Incidents       []K8sIncidentEvent         `json:"incidents"`
	CronJobs        []CronJobStatusDelta       `json:"cronJobs"`
	Jobs            []JobStatusDelta           `json:"jobs"`
	PVCs            []PVCStatusDelta           `json:"pvcs"`
	PVs             []PVStatusDelta            `json:"pvs"`
	ConfigMaps      []ConfigMapStatusDelta     `json:"configMaps"`
	Secrets         []SecretStatusDelta        `json:"secrets"`
	HPAs            []HPAStatusDelta           `json:"hpas,omitempty"`
	NetworkPolicies []NetworkPolicyStatusDelta `json:"networkPolicies,omitempty"`
	PDBs            []PDBStatusDelta           `json:"pdbs,omitempty"`
	ResourceQuotas  []ResourceQuotaStatusDelta `json:"resourceQuotas,omitempty"`
	LimitRanges     []LimitRangeStatusDelta    `json:"limitRanges,omitempty"`
}

