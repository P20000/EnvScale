package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/util/retry"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/types"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// RollbackRequest encapsulates the parameters required to roll back a Deployment.
type RollbackRequest struct {
	ClusterID      string `json:"clusterId"`
	Namespace      string `json:"namespace"`
	DeploymentName string `json:"deploymentName"`
	TargetRevision string `json:"targetRevision"`
	TargetHash     string `json:"targetHash"`
}

// setupRollbackRoutes mounts the authenticated deployment rollback endpoint.
func setupRollbackRoutes(mux *http.ServeMux, clusterManager *k8s.ClusterManager, hub *websocket.Hub) {
	handler := func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// 1. Strict Auth Guard: enforce valid JWT token verification
		claims, err := websocket.AuthenticateRequest(r)
		if err != nil {
			log.Printf("[Rollout Auth Failed] Unauthorized rollback attempt from %s: %v", r.RemoteAddr, err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "Authentication required: valid Bearer token is mandatory to execute deployment rollbacks",
			})
			return
		}

		userIdentifier := "authenticated-user"
		if sub, ok := claims["sub"].(string); ok && sub != "" {
			userIdentifier = sub
		} else if email, ok := claims["email"].(string); ok && email != "" {
			userIdentifier = email
		}

		// 2. Parse request body
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		var req RollbackRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}

		// Extract clusterId from URL path if not in body
		if req.ClusterID == "" {
			parts := strings.Split(r.URL.Path, "/")
			for i, part := range parts {
				if part == "clusters" && i+1 < len(parts) && parts[i+1] != "rollout" {
					req.ClusterID = parts[i+1]
					break
				}
			}
		}

		if req.ClusterID == "" || req.Namespace == "" || req.DeploymentName == "" {
			http.Error(w, "clusterId, namespace, and deploymentName are required", http.StatusBadRequest)
			return
		}

		clientset, err := clusterManager.GetClientset(req.ClusterID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Cluster error: %v", err), http.StatusNotFound)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()

		// 3. Locate the target ReplicaSet
		rsList, err := clientset.AppsV1().ReplicaSets(req.Namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to list ReplicaSets: %v", err), http.StatusInternalServerError)
			return
		}

		var targetPodTemplateSpec *corev1.PodTemplateSpec = nil

		for i := range rsList.Items {
			rs := &rsList.Items[i]
			isOwner := false
			for _, owner := range rs.OwnerReferences {
				if owner.Kind == "Deployment" && owner.Name == req.DeploymentName {
					isOwner = true
					break
				}
			}
			if !isOwner && !strings.HasPrefix(rs.Name, req.DeploymentName+"-") {
				continue
			}

			// Match by revision annotation or template hash
			rsRev := rs.Annotations["deployment.kubernetes.io/revision"]
			rsHash := rs.Labels["pod-template-hash"]
			if (req.TargetRevision != "" && rsRev == req.TargetRevision) ||
				(req.TargetHash != "" && (rsHash == req.TargetHash || strings.HasSuffix(rs.Name, req.TargetHash))) {
				targetPodTemplateSpec = &rs.Spec.Template
				break
			}
		}

		if targetPodTemplateSpec == nil {
			http.Error(w, fmt.Sprintf("Target revision #%s (%s) not found for deployment %s",
				req.TargetHash, req.TargetRevision, req.DeploymentName), http.StatusNotFound)
			return
		}

		// 4. GOTCHA 1 ENFORCED: Execute rollback via RetryOnConflict fetching fresh Deployment
		retryErr := retry.RetryOnConflict(retry.DefaultRetry, func() error {
			freshDep, getErr := clientset.AppsV1().Deployments(req.Namespace).Get(ctx, req.DeploymentName, metav1.GetOptions{})
			if getErr != nil {
				return getErr
			}

			freshDep.Spec.Template = *targetPodTemplateSpec

			if freshDep.Annotations == nil {
				freshDep.Annotations = make(map[string]string)
			}
			freshDep.Annotations["kubernetes.io/change-cause"] = fmt.Sprintf("EnvScale Rollback by %s to revision #%s at %s",
				userIdentifier, req.TargetHash, time.Now().UTC().Format(time.RFC3339))

			_, updateErr := clientset.AppsV1().Deployments(req.Namespace).Update(ctx, freshDep, metav1.UpdateOptions{})
			return updateErr
		})

		if retryErr != nil {
			log.Printf("[Rollout Error] Rollback failed for deployment %s/%s: %v", req.Namespace, req.DeploymentName, retryErr)
			http.Error(w, fmt.Sprintf("Rollback failed: %v", retryErr), http.StatusInternalServerError)
			return
		}

		// 5. Audit Logging & Real-time Event Notification
		log.Printf("[Rollout Audit] User %s executed rollback on cluster %s for deployment %s/%s to revision #%s",
			userIdentifier, req.ClusterID, req.Namespace, req.DeploymentName, req.TargetHash)

		hub.BroadcastEvent(types.EventRolloutRollback, req.ClusterID, map[string]interface{}{
			"clusterId":      req.ClusterID,
			"namespace":      req.Namespace,
			"deploymentName": req.DeploymentName,
			"targetHash":     req.TargetHash,
			"targetRevision": req.TargetRevision,
			"user":           userIdentifier,
			"timestamp":      time.Now().UTC().Format(time.RFC3339),
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "success",
			"message":    fmt.Sprintf("Deployment %s rolled back to revision #%s", req.DeploymentName, req.TargetHash),
			"deployment": req.DeploymentName,
			"namespace":  req.Namespace,
			"revision":   req.TargetRevision,
			"hash":       req.TargetHash,
		})
	}

	mux.HandleFunc("/api/v1/clusters/rollout/rollback", handler)
	mux.HandleFunc("/api/v1/rollout/rollback", handler)
}
