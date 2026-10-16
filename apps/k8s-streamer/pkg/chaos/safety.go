package chaos

import (
	"context"
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// ErrPDBViolation is returned when chaos injection is blocked by a PodDisruptionBudget guardrail
type ErrPDBViolation struct {
	PDBName            string `json:"pdbName"`
	DisruptionsAllowed int32  `json:"disruptionsAllowed"`
	Workload           string `json:"workload"`
	Namespace          string `json:"namespace"`
	Message            string `json:"message"`
}

func (e *ErrPDBViolation) Error() string {
	return e.Message
}

// PDBChecker resolves PodDisruptionBudget safety for a workload
type PDBChecker interface {
	CheckPDBSafety(clusterID, namespace, workloadName string, labels map[string]string) (*types.PDBStatusDelta, bool)
}

// checkWorkloadPDBSafety validates whether the target workload has enough disruption budget
func (inj *Injector) checkWorkloadPDBSafety(ctx context.Context, clusterID, namespace, targetName string, faultType FaultType, force bool) (string, bool, error) {
	if inj.pdbChecker == nil {
		return "", false, nil
	}

	var targetLabels map[string]string
	workloadName := targetName

	clientset, cErr := inj.provider.GetClientset(clusterID)
	if cErr == nil && clientset != nil {
		if pod, err := clientset.CoreV1().Pods(namespace).Get(ctx, targetName, metav1.GetOptions{}); err == nil {
			targetLabels = pod.Labels
			if pod.Labels != nil && pod.Labels["app"] != "" {
				workloadName = pod.Labels["app"]
			} else {
				for _, ref := range pod.OwnerReferences {
					if ref.Kind == "ReplicaSet" || ref.Kind == "Deployment" {
						workloadName = ref.Name
						break
					}
				}
			}
		} else if dep, err := clientset.AppsV1().Deployments(namespace).Get(ctx, targetName, metav1.GetOptions{}); err == nil {
			targetLabels = dep.Spec.Template.Labels
			workloadName = dep.Name
		}
	}

	pdbDelta, found := inj.pdbChecker.CheckPDBSafety(clusterID, namespace, workloadName, targetLabels)
	if !found || pdbDelta == nil {
		return "", false, nil
	}

	pdbName := pdbDelta.Name
	var pdbBreached bool

	if pdbDelta.DisruptionsAllowed <= 0 {
		if !force {
			return pdbName, false, &ErrPDBViolation{
				PDBName:            pdbDelta.Name,
				DisruptionsAllowed: pdbDelta.DisruptionsAllowed,
				Workload:           targetName,
				Namespace:          namespace,
				Message: fmt.Sprintf(
					"cannot inject chaos: workload %s/%s has 0 allowed disruptions under PDB %s",
					namespace, targetName, pdbDelta.Name,
				),
			}
		}
		// Force override enabled: user intentionally bypassed PDB safety
		pdbBreached = true
	}

	return pdbName, pdbBreached, nil
}
