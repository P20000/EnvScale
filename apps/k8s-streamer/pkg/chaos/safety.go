package chaos

import (
	"context"
	"fmt"
	"strings"

	policyv1 "k8s.io/api/policy/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// ErrPDBViolation is returned when chaos injection is blocked by a PodDisruptionBudget guardrail.
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

// ErrPDBSafetyCheckFailed is returned when PDB safety validation cannot be verified (SEC-M5 fail-closed).
type ErrPDBSafetyCheckFailed struct {
	Workload  string `json:"workload"`
	Namespace string `json:"namespace"`
	Message   string `json:"message"`
	Cause     error  `json:"-"`
}

func (e *ErrPDBSafetyCheckFailed) Error() string {
	return e.Message
}

func (e *ErrPDBSafetyCheckFailed) Unwrap() error {
	return e.Cause
}

// PDBChecker resolves PodDisruptionBudget safety for a workload.
type PDBChecker interface {
	CheckPDBSafety(clusterID, namespace, workloadName string, labels map[string]string) (*types.PDBStatusDelta, bool)
}

// countActiveDisruptions returns the number of active in-flight faults affecting the target workload.
func (inj *Injector) countActiveDisruptions(clusterID, namespace, workloadName, targetName string) int32 {
	inj.mu.RLock()
	defer inj.mu.RUnlock()

	var count int32
	for _, f := range inj.activeFaults {
		if f.ClusterID == clusterID && f.Namespace == namespace {
			if (workloadName != "" && f.WorkloadName == workloadName) ||
				f.Name == workloadName ||
				f.Name == targetName {
				count++
			}
		}
	}
	return count
}

func matchLivePDB(pdb policyv1.PodDisruptionBudget, workloadName string, targetLabels map[string]string) (bool, error) {
	if pdb.Spec.Selector != nil {
		selector, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
		if err != nil {
			return false, fmt.Errorf("invalid selector on PDB %s/%s: %w", pdb.Namespace, pdb.Name, err)
		}
		if !selector.Empty() && len(targetLabels) > 0 && selector.Matches(labels.Set(targetLabels)) {
			return true, nil
		}
		if pdb.Spec.Selector.MatchLabels != nil {
			if app, ok := pdb.Spec.Selector.MatchLabels["app"]; ok && strings.EqualFold(app, workloadName) {
				return true, nil
			}
		}
	}

	pdbLower := strings.ToLower(pdb.Name)
	workloadLower := strings.ToLower(workloadName)
	cleanPDB := strings.TrimSuffix(strings.TrimSuffix(pdbLower, "-pdb"), "-disruption-budget")
	if workloadLower != "" && (cleanPDB == workloadLower || strings.Contains(pdbLower, workloadLower) || strings.Contains(workloadLower, cleanPDB)) {
		return true, nil
	}
	return false, nil
}

// checkWorkloadPDBSafety validates whether the target workload has enough disruption budget.
// SEC-M5: Always fails closed on context cancellation/timeout, clientset errors, or Kubernetes API/RBAC failures.
func (inj *Injector) checkWorkloadPDBSafety(ctx context.Context, clusterID, namespace, targetName string, faultType FaultType, force bool) (string, bool, string, error) {
	if err := ctx.Err(); err != nil {
		return "", false, targetName, &ErrPDBSafetyCheckFailed{
			Workload:  targetName,
			Namespace: namespace,
			Message:   fmt.Sprintf("PDB safety check aborted before execution for %s/%s: %v", namespace, targetName, err),
			Cause:     err,
		}
	}

	clientset, cErr := inj.provider.GetClientset(clusterID)
	if cErr != nil || clientset == nil {
		return "", false, targetName, &ErrPDBSafetyCheckFailed{
			Workload:  targetName,
			Namespace: namespace,
			Message:   fmt.Sprintf("PDB safety check failed: cluster %q clientset unavailable: %v", clusterID, cErr),
			Cause:     cErr,
		}
	}

	var targetLabels map[string]string
	workloadName := targetName

	pod, podErr := clientset.CoreV1().Pods(namespace).Get(ctx, targetName, metav1.GetOptions{})
	if podErr == nil {
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
	} else if apierrors.IsNotFound(podErr) {
		dep, depErr := clientset.AppsV1().Deployments(namespace).Get(ctx, targetName, metav1.GetOptions{})
		if depErr != nil {
			return "", false, workloadName, &ErrPDBSafetyCheckFailed{
				Workload:  targetName,
				Namespace: namespace,
				Message:   fmt.Sprintf("PDB safety check failed: unable to inspect target %s/%s: %v", namespace, targetName, depErr),
				Cause:     depErr,
			}
		}
		targetLabels = dep.Spec.Template.Labels
		workloadName = dep.Name
	} else {
		return "", false, workloadName, &ErrPDBSafetyCheckFailed{
			Workload:  targetName,
			Namespace: namespace,
			Message:   fmt.Sprintf("PDB safety check failed: pod lookup error for %s/%s: %v", namespace, targetName, podErr),
			Cause:     podErr,
		}
	}

	// Live Kubernetes PDB API check — fail closed on any RBAC (403), timeout, or API error even if force=true.
	pdbList, pdbErr := clientset.PolicyV1().PodDisruptionBudgets(namespace).List(ctx, metav1.ListOptions{})
	if pdbErr != nil {
		return "", false, workloadName, &ErrPDBSafetyCheckFailed{
			Workload:  targetName,
			Namespace: namespace,
			Message:   fmt.Sprintf("PDB safety check failed (cannot verify disruption budgets in %s): %v", namespace, pdbErr),
			Cause:     pdbErr,
		}
	}

	var pdbName string
	var disruptionsAllowed int32
	var found bool

	for _, item := range pdbList.Items {
		matched, matchErr := matchLivePDB(item, workloadName, targetLabels)
		if matchErr != nil {
			return "", false, workloadName, &ErrPDBSafetyCheckFailed{
				Workload:  targetName,
				Namespace: namespace,
				Message:   fmt.Sprintf("PDB safety check failed: %v", matchErr),
				Cause:     matchErr,
			}
		}
		if matched {
			pdbName = item.Name
			disruptionsAllowed = item.Status.DisruptionsAllowed
			found = true
			break
		}
	}

	if !found && inj.pdbChecker != nil {
		if pdbDelta, ok := inj.pdbChecker.CheckPDBSafety(clusterID, namespace, workloadName, targetLabels); ok && pdbDelta != nil {
			pdbName = pdbDelta.Name
			disruptionsAllowed = pdbDelta.DisruptionsAllowed
			found = true
		}
	}

	if !found {
		return "", false, workloadName, nil
	}

	var pdbBreached bool
	activeInflight := inj.countActiveDisruptions(clusterID, namespace, workloadName, targetName)
	effectiveAllowed := disruptionsAllowed - activeInflight

	if effectiveAllowed <= 0 {
		if !force {
			return pdbName, false, workloadName, &ErrPDBViolation{
				PDBName:            pdbName,
				DisruptionsAllowed: effectiveAllowed,
				Workload:           targetName,
				Namespace:          namespace,
				Message: fmt.Sprintf(
					"cannot inject chaos: workload %s/%s has %d allowed disruptions under PDB %s (active in-flight disruptions: %d)",
					namespace, targetName, effectiveAllowed, pdbName, activeInflight,
				),
			}
		}
		pdbBreached = true
	}

	_ = faultType
	return pdbName, pdbBreached, workloadName, nil
}
