package chaos

import (
	"context"
	"testing"
	"time"

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
