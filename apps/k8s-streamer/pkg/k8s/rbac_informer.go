package k8s

import (
	"log"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// setupRBACInformers attaches Informer event handlers for ServiceAccounts, Roles, RoleBindings, ClusterRoles, and ClusterRoleBindings
func (im *InformerManager) setupRBACInformers() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RBAC Informer] Warning: RBAC informers initialization encountered error for cluster %s: %v", im.clusterID, r)
		}
	}()

	// 1. ServiceAccounts Informer
	saInformer := im.factory.Core().V1().ServiceAccounts().Informer()
	saInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if sa, ok := obj.(*corev1.ServiceAccount); ok {
				im.emitServiceAccountDelta(sa)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if sa, ok := newObj.(*corev1.ServiceAccount); ok {
				im.emitServiceAccountDelta(sa)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if sa, ok := obj.(*corev1.ServiceAccount); ok {
				im.emitServiceAccountDeleted(sa)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if sa, ok := tombstone.Obj.(*corev1.ServiceAccount); ok {
					im.emitServiceAccountDeleted(sa)
				}
			}
		},
	})

	// 2. RoleBindings Informer
	rbInformer := im.factory.Rbac().V1().RoleBindings().Informer()
	rbInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if rb, ok := obj.(*rbacv1.RoleBinding); ok {
				im.emitRoleBindingDelta(rb)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if rb, ok := newObj.(*rbacv1.RoleBinding); ok {
				im.emitRoleBindingDelta(rb)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if rb, ok := obj.(*rbacv1.RoleBinding); ok {
				im.emitRoleBindingDeleted(rb)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if rb, ok := tombstone.Obj.(*rbacv1.RoleBinding); ok {
					im.emitRoleBindingDeleted(rb)
				}
			}
		},
	})

	// 3. ClusterRoleBindings Informer
	crbInformer := im.factory.Rbac().V1().ClusterRoleBindings().Informer()
	crbInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if crb, ok := obj.(*rbacv1.ClusterRoleBinding); ok {
				im.emitClusterRoleBindingDelta(crb)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if crb, ok := newObj.(*rbacv1.ClusterRoleBinding); ok {
				im.emitClusterRoleBindingDelta(crb)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if crb, ok := obj.(*rbacv1.ClusterRoleBinding); ok {
				im.emitClusterRoleBindingDeleted(crb)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if crb, ok := tombstone.Obj.(*rbacv1.ClusterRoleBinding); ok {
					im.emitClusterRoleBindingDeleted(crb)
				}
			}
		},
	})

	// 4. Roles Informer
	roleInformer := im.factory.Rbac().V1().Roles().Informer()
	roleInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if role, ok := obj.(*rbacv1.Role); ok {
				im.emitRoleDelta(role)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if role, ok := newObj.(*rbacv1.Role); ok {
				im.emitRoleDelta(role)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if role, ok := obj.(*rbacv1.Role); ok {
				im.emitRoleDeleted(role)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if role, ok := tombstone.Obj.(*rbacv1.Role); ok {
					im.emitRoleDeleted(role)
				}
			}
		},
	})

	// 5. ClusterRoles Informer
	crInformer := im.factory.Rbac().V1().ClusterRoles().Informer()
	crInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if cr, ok := obj.(*rbacv1.ClusterRole); ok {
				im.emitClusterRoleDelta(cr)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if cr, ok := newObj.(*rbacv1.ClusterRole); ok {
				im.emitClusterRoleDelta(cr)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if cr, ok := obj.(*rbacv1.ClusterRole); ok {
				im.emitClusterRoleDeleted(cr)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if cr, ok := tombstone.Obj.(*rbacv1.ClusterRole); ok {
					im.emitClusterRoleDeleted(cr)
				}
			}
		},
	})
}

// Extract helpers
func (im *InformerManager) extractServiceAccountDelta(sa *corev1.ServiceAccount) types.ServiceAccountDelta {
	var secrets []string
	for _, sec := range sa.Secrets {
		secrets = append(secrets, sec.Name)
	}
	return types.ServiceAccountDelta{
		Name:                         sa.Name,
		Namespace:                    sa.Namespace,
		AutomountServiceAccountToken: sa.AutomountServiceAccountToken,
		Secrets:                      secrets,
		Labels:                       sa.Labels,
		CreatedAt:                    sa.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) extractRoleBindingDelta(rb *rbacv1.RoleBinding) types.RoleBindingDelta {
	var subjects []types.RBACSubjectInfo
	for _, s := range rb.Subjects {
		subjects = append(subjects, types.RBACSubjectInfo{
			Kind:      s.Kind,
			Name:      s.Name,
			Namespace: s.Namespace,
		})
	}
	return types.RoleBindingDelta{
		Name:      rb.Name,
		Namespace: rb.Namespace,
		RoleRef: types.RBACRoleRefInfo{
			Kind:     rb.RoleRef.Kind,
			Name:     rb.RoleRef.Name,
			APIGroup: rb.RoleRef.APIGroup,
		},
		Subjects:  subjects,
		Labels:    rb.Labels,
		CreatedAt: rb.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) extractClusterRoleBindingDelta(crb *rbacv1.ClusterRoleBinding) types.ClusterRoleBindingDelta {
	var subjects []types.RBACSubjectInfo
	for _, s := range crb.Subjects {
		subjects = append(subjects, types.RBACSubjectInfo{
			Kind:      s.Kind,
			Name:      s.Name,
			Namespace: s.Namespace,
		})
	}
	return types.ClusterRoleBindingDelta{
		Name: crb.Name,
		RoleRef: types.RBACRoleRefInfo{
			Kind:     crb.RoleRef.Kind,
			Name:     crb.RoleRef.Name,
			APIGroup: crb.RoleRef.APIGroup,
		},
		Subjects:  subjects,
		Labels:    crb.Labels,
		CreatedAt: crb.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) extractRoleDelta(r *rbacv1.Role) types.RoleDelta {
	var rules []types.RBACPolicyRuleInfo
	for _, rule := range r.Rules {
		rules = append(rules, types.RBACPolicyRuleInfo{
			Verbs:         rule.Verbs,
			APIGroups:     rule.APIGroups,
			Resources:     rule.Resources,
			ResourceNames: rule.ResourceNames,
		})
	}
	return types.RoleDelta{
		Name:      r.Name,
		Namespace: r.Namespace,
		Rules:     rules,
		Labels:    r.Labels,
		CreatedAt: r.CreationTimestamp.Time.UTC(),
	}
}

func (im *InformerManager) extractClusterRoleDelta(cr *rbacv1.ClusterRole) types.ClusterRoleDelta {
	var rules []types.RBACPolicyRuleInfo
	for _, rule := range cr.Rules {
		rules = append(rules, types.RBACPolicyRuleInfo{
			Verbs:         rule.Verbs,
			APIGroups:     rule.APIGroups,
			Resources:     rule.Resources,
			ResourceNames: rule.ResourceNames,
		})
	}
	return types.ClusterRoleDelta{
		Name:      cr.Name,
		Rules:     rules,
		Labels:    cr.Labels,
		CreatedAt: cr.CreationTimestamp.Time.UTC(),
	}
}

// Emitters
func (im *InformerManager) emitServiceAccountDelta(sa *corev1.ServiceAccount) {
	delta := im.extractServiceAccountDelta(sa)
	im.hub.BroadcastEvent(types.EventServiceAccountMutated, im.clusterID, delta)
}

func (im *InformerManager) emitServiceAccountDeleted(sa *corev1.ServiceAccount) {
	im.hub.BroadcastEvent(types.EventServiceAccountDeleted, im.clusterID, map[string]string{
		"name":      sa.Name,
		"namespace": sa.Namespace,
	})
}

func (im *InformerManager) emitRoleBindingDelta(rb *rbacv1.RoleBinding) {
	delta := im.extractRoleBindingDelta(rb)
	im.hub.BroadcastEvent(types.EventRoleBindingMutated, im.clusterID, delta)
}

func (im *InformerManager) emitRoleBindingDeleted(rb *rbacv1.RoleBinding) {
	im.hub.BroadcastEvent(types.EventRoleBindingDeleted, im.clusterID, map[string]string{
		"name":      rb.Name,
		"namespace": rb.Namespace,
	})
}

func (im *InformerManager) emitClusterRoleBindingDelta(crb *rbacv1.ClusterRoleBinding) {
	delta := im.extractClusterRoleBindingDelta(crb)
	im.hub.BroadcastEvent(types.EventClusterRoleBindingMutated, im.clusterID, delta)
}

func (im *InformerManager) emitClusterRoleBindingDeleted(crb *rbacv1.ClusterRoleBinding) {
	im.hub.BroadcastEvent(types.EventClusterRoleBindingDeleted, im.clusterID, map[string]string{
		"name": crb.Name,
	})
}

func (im *InformerManager) emitRoleDelta(role *rbacv1.Role) {
	delta := im.extractRoleDelta(role)
	im.hub.BroadcastEvent(types.EventRoleMutated, im.clusterID, delta)
}

func (im *InformerManager) emitRoleDeleted(role *rbacv1.Role) {
	im.hub.BroadcastEvent(types.EventRoleDeleted, im.clusterID, map[string]string{
		"name":      role.Name,
		"namespace": role.Namespace,
	})
}

func (im *InformerManager) emitClusterRoleDelta(cr *rbacv1.ClusterRole) {
	delta := im.extractClusterRoleDelta(cr)
	im.hub.BroadcastEvent(types.EventClusterRoleMutated, im.clusterID, delta)
}

func (im *InformerManager) emitClusterRoleDeleted(cr *rbacv1.ClusterRole) {
	im.hub.BroadcastEvent(types.EventClusterRoleDeleted, im.clusterID, map[string]string{
		"name": cr.Name,
	})
}

// Snapshot getters
func (im *InformerManager) GetServiceAccountsSnapshot() []types.ServiceAccountDelta {
	var list []types.ServiceAccountDelta
	store := im.factory.Core().V1().ServiceAccounts().Informer().GetStore()
	for _, obj := range store.List() {
		if sa, ok := obj.(*corev1.ServiceAccount); ok {
			list = append(list, im.extractServiceAccountDelta(sa))
		}
	}
	return list
}

func (im *InformerManager) GetRoleBindingsSnapshot() []types.RoleBindingDelta {
	var list []types.RoleBindingDelta
	store := im.factory.Rbac().V1().RoleBindings().Informer().GetStore()
	for _, obj := range store.List() {
		if rb, ok := obj.(*rbacv1.RoleBinding); ok {
			list = append(list, im.extractRoleBindingDelta(rb))
		}
	}
	return list
}

func (im *InformerManager) GetClusterRoleBindingsSnapshot() []types.ClusterRoleBindingDelta {
	var list []types.ClusterRoleBindingDelta
	store := im.factory.Rbac().V1().ClusterRoleBindings().Informer().GetStore()
	for _, obj := range store.List() {
		if crb, ok := obj.(*rbacv1.ClusterRoleBinding); ok {
			list = append(list, im.extractClusterRoleBindingDelta(crb))
		}
	}
	return list
}

func (im *InformerManager) GetRolesSnapshot() []types.RoleDelta {
	var list []types.RoleDelta
	store := im.factory.Rbac().V1().Roles().Informer().GetStore()
	for _, obj := range store.List() {
		if r, ok := obj.(*rbacv1.Role); ok {
			list = append(list, im.extractRoleDelta(r))
		}
	}
	return list
}

func (im *InformerManager) GetClusterRolesSnapshot() []types.ClusterRoleDelta {
	var list []types.ClusterRoleDelta
	store := im.factory.Rbac().V1().ClusterRoles().Informer().GetStore()
	for _, obj := range store.List() {
		if cr, ok := obj.(*rbacv1.ClusterRole); ok {
			list = append(list, im.extractClusterRoleDelta(cr))
		}
	}
	return list
}
