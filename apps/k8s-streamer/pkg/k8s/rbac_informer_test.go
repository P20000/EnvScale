package k8s

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestExtractRBACDeltas(t *testing.T) {
	hub := websocket.NewHub()
	clientset := fake.NewSimpleClientset()
	im := NewInformerManagerWithClientset(clientset, hub, "test-cluster")

	// 1. ServiceAccount Delta
	automountTrue := true
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "payment-sa",
			Namespace:         "prod",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		AutomountServiceAccountToken: &automountTrue,
	}
	saDelta := im.extractServiceAccountDelta(sa)
	if saDelta.Name != "payment-sa" || saDelta.Namespace != "prod" {
		t.Fatalf("expected payment-sa in prod, got %s/%s", saDelta.Namespace, saDelta.Name)
	}
	if saDelta.AutomountServiceAccountToken == nil || !*saDelta.AutomountServiceAccountToken {
		t.Fatalf("expected automount token true")
	}

	// 2. RoleBinding Delta
	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "payment-rb",
			Namespace:         "prod",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		RoleRef: rbacv1.RoleRef{
			Kind:     "Role",
			Name:     "payment-role",
			APIGroup: "rbac.authorization.k8s.io",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "payment-sa",
				Namespace: "prod",
			},
		},
	}
	rbDelta := im.extractRoleBindingDelta(rb)
	if rbDelta.Name != "payment-rb" || rbDelta.RoleRef.Name != "payment-role" {
		t.Fatalf("unexpected rolebinding delta: %+v", rbDelta)
	}
	if len(rbDelta.Subjects) != 1 || rbDelta.Subjects[0].Name != "payment-sa" {
		t.Fatalf("expected subject payment-sa, got %+v", rbDelta.Subjects)
	}

	// 3. ClusterRoleBinding Delta
	crb := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "cluster-admin-binding",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		RoleRef: rbacv1.RoleRef{
			Kind:     "ClusterRole",
			Name:     "cluster-admin",
			APIGroup: "rbac.authorization.k8s.io",
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      "admin-sa",
				Namespace: "kube-system",
			},
		},
	}
	crbDelta := im.extractClusterRoleBindingDelta(crb)
	if crbDelta.Name != "cluster-admin-binding" || crbDelta.RoleRef.Name != "cluster-admin" {
		t.Fatalf("unexpected clusterrolebinding delta: %+v", crbDelta)
	}

	// 4. Role Delta
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "payment-role",
			Namespace:         "prod",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		Rules: []rbacv1.PolicyRule{
			{
				Verbs:     []string{"get", "list", "watch"},
				APIGroups: []string{""},
				Resources: []string{"pods", "secrets"},
			},
		},
	}
	roleDelta := im.extractRoleDelta(role)
	if len(roleDelta.Rules) != 1 || len(roleDelta.Rules[0].Verbs) != 3 {
		t.Fatalf("unexpected role delta rules: %+v", roleDelta.Rules)
	}

	// 5. Pod Delta ServiceAccount extraction
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "payment-pod-1",
			Namespace:         "prod",
			CreationTimestamp: metav1.NewTime(time.Now()),
		},
		Spec: corev1.PodSpec{
			ServiceAccountName:           "payment-sa",
			AutomountServiceAccountToken: &automountTrue,
		},
	}
	podDelta := im.extractPodDelta(pod)
	if podDelta.ServiceAccountName != "payment-sa" {
		t.Fatalf("expected ServiceAccountName payment-sa, got %s", podDelta.ServiceAccountName)
	}
	if podDelta.ServiceAccount != "payment-sa" {
		t.Fatalf("expected ServiceAccount payment-sa, got %s", podDelta.ServiceAccount)
	}
	if podDelta.AutomountServiceAccountToken == nil || !*podDelta.AutomountServiceAccountToken {
		t.Fatalf("expected automount token true on pod delta")
	}
}
