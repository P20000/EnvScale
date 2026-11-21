package types

import "time"

// Event Type Constants for Kubernetes RBAC resources
const (
	EventServiceAccountMutated     = "EVENT_SERVICEACCOUNT_MUTATED"
	EventServiceAccountDeleted     = "EVENT_SERVICEACCOUNT_DELETED"
	EventRoleBindingMutated        = "EVENT_ROLEBINDING_MUTATED"
	EventRoleBindingDeleted        = "EVENT_ROLEBINDING_DELETED"
	EventClusterRoleBindingMutated = "EVENT_CLUSTERROLEBINDING_MUTATED"
	EventClusterRoleBindingDeleted = "EVENT_CLUSTERROLEBINDING_DELETED"
	EventRoleMutated               = "EVENT_ROLE_MUTATED"
	EventRoleDeleted               = "EVENT_ROLE_DELETED"
	EventClusterRoleMutated        = "EVENT_CLUSTERROLE_MUTATED"
	EventClusterRoleDeleted        = "EVENT_CLUSTERROLE_DELETED"
)

// RBACSubjectInfo represents a bound subject (ServiceAccount, User, or Group)
type RBACSubjectInfo struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

// RBACRoleRefInfo represents the referenced role in a binding
type RBACRoleRefInfo struct {
	Kind     string `json:"kind"` // "Role" | "ClusterRole"
	Name     string `json:"name"`
	APIGroup string `json:"apiGroup"`
}

// RBACPolicyRuleInfo represents an individual policy authorization rule
type RBACPolicyRuleInfo struct {
	Verbs         []string `json:"verbs"`
	APIGroups     []string `json:"apiGroups,omitempty"`
	Resources     []string `json:"resources,omitempty"`
	ResourceNames []string `json:"resourceNames,omitempty"`
}

// ServiceAccountDelta represents ServiceAccount state
type ServiceAccountDelta struct {
	Name                         string            `json:"name"`
	Namespace                    string            `json:"namespace"`
	AutomountServiceAccountToken *bool             `json:"automountServiceAccountToken,omitempty"`
	Secrets                      []string          `json:"secrets,omitempty"`
	Labels                       map[string]string `json:"labels,omitempty"`
	CreatedAt                    time.Time         `json:"createdAt"`
}

// RoleBindingDelta represents RoleBinding state
type RoleBindingDelta struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	RoleRef   RBACRoleRefInfo   `json:"roleRef"`
	Subjects  []RBACSubjectInfo `json:"subjects"`
	Labels    map[string]string `json:"labels,omitempty"`
	CreatedAt time.Time         `json:"createdAt"`
}

// ClusterRoleBindingDelta represents ClusterRoleBinding state
type ClusterRoleBindingDelta struct {
	Name      string            `json:"name"`
	RoleRef   RBACRoleRefInfo   `json:"roleRef"`
	Subjects  []RBACSubjectInfo `json:"subjects"`
	Labels    map[string]string `json:"labels,omitempty"`
	CreatedAt time.Time         `json:"createdAt"`
}

// RoleDelta represents Role state
type RoleDelta struct {
	Name      string               `json:"name"`
	Namespace string               `json:"namespace"`
	Rules     []RBACPolicyRuleInfo `json:"rules"`
	Labels    map[string]string    `json:"labels,omitempty"`
	CreatedAt time.Time            `json:"createdAt"`
}

// ClusterRoleDelta represents ClusterRole state
type ClusterRoleDelta struct {
	Name      string               `json:"name"`
	Rules     []RBACPolicyRuleInfo `json:"rules"`
	Labels    map[string]string    `json:"labels,omitempty"`
	CreatedAt time.Time            `json:"createdAt"`
}
