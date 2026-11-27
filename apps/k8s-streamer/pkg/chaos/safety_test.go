package chaos

import (
	"context"
	"errors"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

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

type failingClientsetProvider struct{ err error }

func (f *failingClientsetProvider) GetClientset(clusterID string) (kubernetes.Interface, error) {
	return nil, f.err
}

func TestChaosPDBSafety_FailsClosedOnLookupErrorsTimeoutsAndForbidden(t *testing.T) {
	makePod := func() *corev1.Pod {
		return &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "api-pod-1",
				Namespace: "prod",
				Labels:    map[string]string{"app": "api"},
			},
		}
	}

	// 1. PDB list returns 403 Forbidden -> must fail closed EVEN with force=true and NOT delete pod
	csForbiddenPDB := fake.NewSimpleClientset(makePod())
	csForbiddenPDB.PrependReactor("list", "poddisruptionbudgets", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Group: "policy", Resource: "poddisruptionbudgets"}, "", errors.New("rbac denied"))
	})
	inj1 := NewInjector(&mockClientsetProvider{clientset: csForbiddenPDB}, &mockBroadcaster{})
	for _, force := range []bool{false, true} {
		_, err := inj1.InjectFault(context.Background(), "c-1", "prod", "api-pod-1", FaultCrash, force)
		var safetyErr *ErrPDBSafetyCheckFailed
		if !errors.As(err, &safetyErr) {
			t.Fatalf("SEC-M5: expected *ErrPDBSafetyCheckFailed when PDB list is 403 (force=%v), got %T: %v", force, err, err)
		}
	}
	if _, getErr := csForbiddenPDB.CoreV1().Pods("prod").Get(context.Background(), "api-pod-1", metav1.GetOptions{}); getErr != nil {
		t.Fatalf("SEC-M5: target pod was deleted despite PDB lookup failure: %v", getErr)
	}

	// 2. Pod lookup returns 403 Forbidden -> must fail closed and leave pod intact
	csForbiddenPod := fake.NewSimpleClientset(makePod())
	csForbiddenPod.PrependReactor("get", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "pods"}, "api-pod-1", errors.New("rbac denied"))
	})
	inj2 := NewInjector(&mockClientsetProvider{clientset: csForbiddenPod}, &mockBroadcaster{})
	_, err := inj2.InjectFault(context.Background(), "c-1", "prod", "api-pod-1", FaultCrash, false)
	var safetyErrPod *ErrPDBSafetyCheckFailed
	if !errors.As(err, &safetyErrPod) {
		t.Fatalf("SEC-M5: expected *ErrPDBSafetyCheckFailed on pod lookup 403, got %T: %v", err, err)
	}

	// 3. Timed-out / cancelled context -> must fail closed
	csHealthy := fake.NewSimpleClientset(makePod())
	inj3 := NewInjector(&mockClientsetProvider{clientset: csHealthy}, &mockBroadcaster{})
	expiredCtx, cancel := context.WithTimeout(context.Background(), -time.Second)
	defer cancel()
	_, err = inj3.InjectFault(expiredCtx, "c-1", "prod", "api-pod-1", FaultCrash, true)
	var safetyErrTimeout *ErrPDBSafetyCheckFailed
	if !errors.As(err, &safetyErrTimeout) {
		t.Fatalf("SEC-M5: expected *ErrPDBSafetyCheckFailed on expired context, got %T: %v", err, err)
	}

	// 4. Clientset provider error -> must fail closed
	inj4 := NewInjector(&failingClientsetProvider{err: errors.New("cluster unreachable")}, &mockBroadcaster{})
	_, err = inj4.InjectFault(context.Background(), "c-1", "prod", "api-pod-1", FaultCrash, true)
	var safetyErrProvider *ErrPDBSafetyCheckFailed
	if !errors.As(err, &safetyErrProvider) {
		t.Fatalf("SEC-M5: expected *ErrPDBSafetyCheckFailed on provider error, got %T: %v", err, err)
	}

	// 5. Live policy/v1 PDB with DisruptionsAllowed=0 blocks fault without needing external PDBChecker
	livePDB := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{Name: "api-pdb", Namespace: "prod"},
		Spec: policyv1.PodDisruptionBudgetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
		},
		Status: policyv1.PodDisruptionBudgetStatus{DisruptionsAllowed: 0},
	}
	csLivePDB := fake.NewSimpleClientset(makePod(), livePDB)
	inj5 := NewInjector(&mockClientsetProvider{clientset: csLivePDB}, &mockBroadcaster{})
	_, err = inj5.InjectFault(context.Background(), "c-1", "prod", "api-pod-1", FaultCrash, false)
	var pdbViolation *ErrPDBViolation
	if !errors.As(err, &pdbViolation) {
		t.Fatalf("expected live policyv1 PDB with 0 allowed disruptions to return *ErrPDBViolation, got %T: %v", err, err)
	}
}
