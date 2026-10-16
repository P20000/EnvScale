package chaos

import (
	"context"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

type mockClientsetProvider struct {
	clientset kubernetes.Interface
}

func (m *mockClientsetProvider) GetClientset(clusterID string) (kubernetes.Interface, error) {
	return m.clientset, nil
}

type mockBroadcaster struct{}

func (m *mockBroadcaster) BroadcastEvent(event string, clusterID string, data interface{}) {}

type mockPDBChecker struct {
	pdbs map[string]*types.PDBStatusDelta
}

func (m *mockPDBChecker) CheckPDBSafety(clusterID, namespace, workloadName string, labels map[string]string) (*types.PDBStatusDelta, bool) {
	key := namespace + "/" + workloadName
	if pdb, ok := m.pdbs[key]; ok {
		return pdb, true
	}
	return nil, false
}

func TestChaosPDBGuardrail(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "todo-backend-789",
			Namespace: "default",
			Labels: map[string]string{
				"app": "todo-backend",
			},
		},
	}
	clientset := fake.NewSimpleClientset(pod)
	provider := &mockClientsetProvider{clientset: clientset}
	broadcaster := &mockBroadcaster{}

	checker := &mockPDBChecker{
		pdbs: map[string]*types.PDBStatusDelta{
			"default/todo-backend": {
				Name:               "todo-backend-pdb",
				Namespace:          "default",
				DisruptionsAllowed: 0,
				CurrentHealthy:     2,
				DesiredHealthy:     2,
				CreatedAt:          time.Now(),
			},
		},
	}

	inj := NewInjector(provider, broadcaster, checker)

	ctx := context.Background()

	// 1. Attempt injection without force -> Expect ErrPDBViolation
	_, err := inj.InjectFault(ctx, "cluster-1", "default", "todo-backend-789", FaultCrash, false)
	if err == nil {
		t.Fatalf("expected ErrPDBViolation error, got nil")
	}

	pdbErr, ok := err.(*ErrPDBViolation)
	if !ok {
		t.Fatalf("expected *ErrPDBViolation error type, got %T: %v", err, err)
	}
	if pdbErr.DisruptionsAllowed != 0 {
		t.Errorf("expected 0 disruptions allowed, got %d", pdbErr.DisruptionsAllowed)
	}
	if pdbErr.PDBName != "todo-backend-pdb" {
		t.Errorf("expected PDBName 'todo-backend-pdb', got %s", pdbErr.PDBName)
	}

	// 2. Attempt injection with force: true -> Expect success with PDBBreached: true
	faultID, err := inj.InjectFault(ctx, "cluster-1", "default", "todo-backend-789", FaultCrash, true)
	if err != nil {
		t.Fatalf("expected fault injection with force=true to succeed, got %v", err)
	}
	if faultID == "" {
		t.Errorf("expected non-empty faultID")
	}

	faults := inj.ListFaults("cluster-1")
	if len(faults) != 1 {
		t.Fatalf("expected 1 active fault, got %d", len(faults))
	}
	if !faults[0].PDBBreached {
		t.Errorf("expected PDBBreached to be true when forced")
	}
	if faults[0].PDBName != "todo-backend-pdb" {
		t.Errorf("expected PDBName 'todo-backend-pdb', got %s", faults[0].PDBName)
	}
}

func TestConcurrentMultiFaultEdgeCase(t *testing.T) {
	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "todo-backend-pod-1",
			Namespace: "testing-todo",
			Labels:    map[string]string{"app": "todo-backend"},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "api"}},
		},
	}
	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "todo-backend-pod-2",
			Namespace: "testing-todo",
			Labels:    map[string]string{"app": "todo-backend"},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "api"}},
		},
	}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "todo-backend",
			Namespace: "testing-todo",
			Labels:    map[string]string{"app": "todo-backend"},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: func() *int32 { r := int32(3); return &r }(),
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "todo-backend"}},
			},
		},
	}

	clientset := fake.NewSimpleClientset(pod1, pod2, dep)
	provider := &mockClientsetProvider{clientset: clientset}
	broadcaster := &mockBroadcaster{}

	// PDB allows 2 disruptions initially (3 replicas - 1 minAvailable = 2 allowed)
	checker := &mockPDBChecker{
		pdbs: map[string]*types.PDBStatusDelta{
			"testing-todo/todo-backend": {
				Name:               "todo-backend-pdb",
				Namespace:          "testing-todo",
				DisruptionsAllowed: 2,
				CurrentHealthy:     3,
				DesiredHealthy:     1,
				CreatedAt:          time.Now(),
			},
		},
	}

	inj := NewInjector(provider, broadcaster, checker)
	ctx := context.Background()

	// 1. Fault 1: SIGKILL / Pod Crash on Pod 1 -> Should SUCCEED (effective disruptions left: 1)
	fID1, err := inj.InjectFault(ctx, "minikube", "testing-todo", "todo-backend-pod-1", FaultCrash, false)
	if err != nil {
		t.Fatalf("Fault 1 (Crash) should succeed under PDB: %v", err)
	}
	if fID1 == "" {
		t.Fatal("expected non-empty faultID for Fault 1")
	}

	// 2. Fault 2: OOM Pressure on Pod 2 -> Should SUCCEED (effective disruptions left: 0)
	fID2, err := inj.InjectFault(ctx, "minikube", "testing-todo", "todo-backend-pod-2", FaultOOMPressure, false)
	if err != nil {
		t.Fatalf("Fault 2 (OOM) should succeed under PDB: %v", err)
	}
	if fID2 == "" {
		t.Fatal("expected non-empty faultID for Fault 2")
	}

	// 3. Fault 3: ScaleDown / Network Partition on todo-backend -> MUST BE BLOCKED BY PDB GUARDRAIL!
	_, err = inj.InjectFault(ctx, "minikube", "testing-todo", "todo-backend", FaultScaleDown, false)
	if err == nil {
		t.Fatalf("Fault 3 (ScaleDown) MUST fail with ErrPDBViolation when budget is exhausted")
	}
	pdbErr, ok := err.(*ErrPDBViolation)
	if !ok {
		t.Fatalf("expected *ErrPDBViolation, got: %T: %v", err, err)
	}
	if pdbErr.PDBName != "todo-backend-pdb" {
		t.Errorf("expected PDBName 'todo-backend-pdb', got %s", pdbErr.PDBName)
	}
	if pdbErr.DisruptionsAllowed > 0 {
		t.Errorf("expected effective DisruptionsAllowed <= 0, got %d", pdbErr.DisruptionsAllowed)
	}

	// 4. Fault 3 with Force=true -> Should BYPASS and record PDBBreached=true
	fID3, err := inj.InjectFault(ctx, "minikube", "testing-todo", "todo-backend", FaultScaleDown, true)
	if err != nil {
		t.Fatalf("Fault 3 with force=true should succeed: %v", err)
	}
	if fID3 == "" {
		t.Fatal("expected non-empty faultID for forced Fault 3")
	}

	// Verify the forced fault is marked PDBBreached
	faults := inj.ListFaults("minikube")
	var forcedFault *ActiveFaultInfo
	for i := range faults {
		if faults[i].FaultID == fID3 {
			forcedFault = &faults[i]
			break
		}
	}
	if forcedFault == nil || !forcedFault.PDBBreached {
		t.Errorf("expected forced fault to have PDBBreached=true")
	}
}
