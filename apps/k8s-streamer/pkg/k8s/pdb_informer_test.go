package k8s

import (
	"testing"
	"time"

	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestExtractPDBDelta(t *testing.T) {
	minAvail := intstr.FromInt32(2)
	now := time.Now()

	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "test-backend-pdb",
			Namespace:         "default",
			CreationTimestamp: metav1.Time{Time: now},
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MinAvailable: &minAvail,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "test-backend",
				},
			},
		},
		Status: policyv1.PodDisruptionBudgetStatus{
			CurrentHealthy:     2,
			DesiredHealthy:     2,
			ExpectedPods:       2,
			DisruptionsAllowed: 1,
		},
	}

	clientset := fake.NewSimpleClientset()
	hub := websocket.NewHub()
	im := NewInformerManagerWithClientset(clientset, hub, "test-cluster")

	delta := im.extractPDBDelta(pdb)

	if delta.Name != "test-backend-pdb" {
		t.Errorf("expected Name 'test-backend-pdb', got %s", delta.Name)
	}
	if delta.Namespace != "default" {
		t.Errorf("expected Namespace 'default', got %s", delta.Namespace)
	}
	if delta.MinAvailable != "2" {
		t.Errorf("expected MinAvailable '2', got %s", delta.MinAvailable)
	}
	if delta.DisruptionsAllowed != 1 {
		t.Errorf("expected DisruptionsAllowed 1, got %d", delta.DisruptionsAllowed)
	}
	if delta.MatchLabels["app"] != "test-backend" {
		t.Errorf("expected MatchLabels['app'] 'test-backend', got %s", delta.MatchLabels["app"])
	}
}

func TestCheckWorkloadPDB_Matching(t *testing.T) {
	clientset := fake.NewSimpleClientset()
	hub := websocket.NewHub()
	im := NewInformerManagerWithClientset(clientset, hub, "test-cluster")

	minAvail := intstr.FromString("50%")
	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "todo-backend-pdb",
			Namespace: "testing-todo",
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MinAvailable: &minAvail,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "todo-backend",
				},
			},
		},
		Status: policyv1.PodDisruptionBudgetStatus{
			CurrentHealthy:     3,
			DesiredHealthy:     3,
			ExpectedPods:       3,
			DisruptionsAllowed: 0,
		},
	}

	pdbInformer := im.factory.Policy().V1().PodDisruptionBudgets().Informer()
	pdbInformer.GetStore().Add(pdb)

	// Test 1: Match by label
	delta, ok := im.CheckWorkloadPDB("testing-todo", "todo-backend", map[string]string{"app": "todo-backend"})
	if !ok || delta == nil {
		t.Fatalf("expected PDB match by label, got nil")
	}
	if delta.DisruptionsAllowed != 0 {
		t.Errorf("expected 0 disruptions allowed, got %d", delta.DisruptionsAllowed)
	}
	if delta.Name != "todo-backend-pdb" {
		t.Errorf("expected PDB name todo-backend-pdb, got %s", delta.Name)
	}

	// Test 2: Match by name heuristic
	delta2, ok2 := im.CheckWorkloadPDB("testing-todo", "todo-backend", nil)
	if !ok2 || delta2 == nil {
		t.Fatalf("expected PDB match by name heuristic, got nil")
	}
	if delta2.Name != "todo-backend-pdb" {
		t.Errorf("expected PDB name todo-backend-pdb, got %s", delta2.Name)
	}

	// Test 3: Non-matching namespace
	_, ok3 := im.CheckWorkloadPDB("prod", "todo-backend", map[string]string{"app": "todo-backend"})
	if ok3 {
		t.Errorf("expected no match for different namespace, got match")
	}
}
