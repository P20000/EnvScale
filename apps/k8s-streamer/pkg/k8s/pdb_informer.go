package k8s

import (
	"strings"

	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/tools/cache"

	"github.com/EnvScale/k8s-streamer/pkg/types"
)

// setupPDBInformers attaches Informer event handlers for PodDisruptionBudgets (policy/v1)
func (im *InformerManager) setupPDBInformers() {
	pdbInformer := im.factory.Policy().V1().PodDisruptionBudgets().Informer()
	pdbInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if pdb, ok := obj.(*policyv1.PodDisruptionBudget); ok {
				im.emitPDBDelta(pdb)
			}
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			if pdb, ok := newObj.(*policyv1.PodDisruptionBudget); ok {
				im.emitPDBDelta(pdb)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if pdb, ok := obj.(*policyv1.PodDisruptionBudget); ok {
				im.emitPDBDeleted(pdb)
			} else if tombstone, ok := obj.(cache.DeletedFinalStateUnknown); ok {
				if pdb, ok := tombstone.Obj.(*policyv1.PodDisruptionBudget); ok {
					im.emitPDBDeleted(pdb)
				}
			}
		},
	})
}

// extractPDBDelta converts a policy/v1 PodDisruptionBudget into a PDBStatusDelta payload
func (im *InformerManager) extractPDBDelta(pdb *policyv1.PodDisruptionBudget) types.PDBStatusDelta {
	var minAvailable, maxUnavailable string
	if pdb.Spec.MinAvailable != nil {
		minAvailable = pdb.Spec.MinAvailable.String()
	}
	if pdb.Spec.MaxUnavailable != nil {
		maxUnavailable = pdb.Spec.MaxUnavailable.String()
	}

	matchLabels := make(map[string]string)
	if pdb.Spec.Selector != nil && pdb.Spec.Selector.MatchLabels != nil {
		for k, v := range pdb.Spec.Selector.MatchLabels {
			matchLabels[k] = v
		}
	}

	return types.PDBStatusDelta{
		Name:               pdb.Name,
		Namespace:          pdb.Namespace,
		MinAvailable:       minAvailable,
		MaxUnavailable:     maxUnavailable,
		CurrentHealthy:     pdb.Status.CurrentHealthy,
		DesiredHealthy:     pdb.Status.DesiredHealthy,
		ExpectedPods:       pdb.Status.ExpectedPods,
		DisruptionsAllowed: pdb.Status.DisruptionsAllowed,
		MatchLabels:        matchLabels,
		CreatedAt:          pdb.CreationTimestamp.Time,
	}
}

// emitPDBDelta broadcasts a mutated or added PDB event over WebSocket
func (im *InformerManager) emitPDBDelta(pdb *policyv1.PodDisruptionBudget) {
	delta := im.extractPDBDelta(pdb)
	im.hub.BroadcastEvent(types.EventPDBMutated, im.clusterID, delta)
}

// emitPDBDeleted broadcasts a deleted PDB event over WebSocket
func (im *InformerManager) emitPDBDeleted(pdb *policyv1.PodDisruptionBudget) {
	im.hub.BroadcastEvent(types.EventPDBDeleted, im.clusterID, map[string]string{
		"name":      pdb.Name,
		"namespace": pdb.Namespace,
	})
}

// GetPDBSnapshot returns the current cached state of all PodDisruptionBudgets for this cluster
func (im *InformerManager) GetPDBSnapshot() []types.PDBStatusDelta {
	pdbList := im.factory.Policy().V1().PodDisruptionBudgets().Informer().GetStore().List()
	var pdbs []types.PDBStatusDelta
	for _, obj := range pdbList {
		if pdb, ok := obj.(*policyv1.PodDisruptionBudget); ok {
			pdbs = append(pdbs, im.extractPDBDelta(pdb))
		}
	}
	return pdbs
}

// CheckWorkloadPDB looks up whether a target workload or pod is governed by an active PDB
func (im *InformerManager) CheckWorkloadPDB(namespace string, workloadName string, targetLabels map[string]string) (*types.PDBStatusDelta, bool) {
	pdbList := im.factory.Policy().V1().PodDisruptionBudgets().Informer().GetStore().List()
	workloadLower := strings.ToLower(workloadName)

	for _, obj := range pdbList {
		pdb, ok := obj.(*policyv1.PodDisruptionBudget)
		if !ok || pdb.Namespace != namespace {
			continue
		}

		// 1. Label-selector matching
		if pdb.Spec.Selector != nil {
			selector, err := metav1.LabelSelectorAsSelector(pdb.Spec.Selector)
			if err == nil && !selector.Empty() && len(targetLabels) > 0 {
				if selector.Matches(labels.Set(targetLabels)) {
					delta := im.extractPDBDelta(pdb)
					return &delta, true
				}
			}

			// Check if matchLabels contains app == workloadName
			if pdb.Spec.Selector.MatchLabels != nil {
				if app, ok := pdb.Spec.Selector.MatchLabels["app"]; ok && strings.EqualFold(app, workloadName) {
					delta := im.extractPDBDelta(pdb)
					return &delta, true
				}
			}
		}

		// 2. Name-based heuristic fallback (e.g., todo-backend-pdb -> todo-backend)
		pdbLower := strings.ToLower(pdb.Name)
		cleanPDB := strings.TrimSuffix(pdbLower, "-pdb")
		cleanPDB = strings.TrimSuffix(cleanPDB, "-disruption-budget")
		if workloadLower != "" && (cleanPDB == workloadLower || strings.Contains(pdbLower, workloadLower) || strings.Contains(workloadLower, cleanPDB)) {
			delta := im.extractPDBDelta(pdb)
			return &delta, true
		}
	}

	return nil, false
}
