package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)


type ResourceApplyRequest struct {
	ClusterID    string                 `json:"clusterId"`
	Namespace    string                 `json:"namespace"`
	ResourceKind string                 `json:"resourceKind"`
	ResourceName string                 `json:"resourceName"`
	Manifest     map[string]interface{} `json:"manifest"`
}

func registerResourceRoutes(mux *http.ServeMux, clusterManager *k8s.ClusterManager) {
	// Deletion handler physically removes targeted Kubernetes objects via client-go
	mux.HandleFunc("/api/v1/resource/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete && r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Authenticate and authorize request
		claims, err := websocket.AuthenticateRequest(r)
		if err != nil {
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}
		var req ResourceApplyRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}
		if req.ClusterID == "" || req.ResourceName == "" {
			http.Error(w, "clusterId and resourceName are required", http.StatusBadRequest)
			return
		}

		if authErr := websocket.CheckClusterAuthorization(claims, req.ClusterID); authErr != nil {
			writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster authorization denied: %v", authErr))
			return
		}

		ns := req.Namespace
		if ns == "" {
			ns = "default"
		}

		clientset, err := clusterManager.GetClientset(req.ClusterID)
		if err != nil {
			log.Printf("[Error] Cluster %s clientset unavailable: %v", req.ClusterID, err)
			http.Error(w, fmt.Sprintf("Cluster %s clientset unavailable: %v", req.ClusterID, err), http.StatusNotFound)
			return
		}

		kind := strings.ToLower(req.ResourceKind)
		ctx := r.Context()
		deleteOpts := metav1.DeleteOptions{}

		switch {
		case kind == "pod" || kind == "k8spod":
			err = clientset.CoreV1().Pods(ns).Delete(ctx, req.ResourceName, deleteOpts)
		case kind == "service" || kind == "k8sservice":
			err = clientset.CoreV1().Services(ns).Delete(ctx, req.ResourceName, deleteOpts)
		case kind == "deployment" || kind == "k8sdeployment" || kind == "workload" || kind == "k8sworkload":
			err = clientset.AppsV1().Deployments(ns).Delete(ctx, req.ResourceName, deleteOpts)
		case kind == "statefulset" || kind == "k8sstatefulset":
			err = clientset.AppsV1().StatefulSets(ns).Delete(ctx, req.ResourceName, deleteOpts)
		case kind == "replicaset" || kind == "k8sreplicaset":
			err = clientset.AppsV1().ReplicaSets(ns).Delete(ctx, req.ResourceName, deleteOpts)
		case kind == "ingress" || kind == "k8singress":
			err = clientset.NetworkingV1().Ingresses(ns).Delete(ctx, req.ResourceName, deleteOpts)
		default:
			log.Printf("[Warning] Unhandled resourceKind for client-go deletion: %s", req.ResourceKind)
			http.Error(w, fmt.Sprintf("Unsupported resource kind for deletion: %s", req.ResourceKind), http.StatusBadRequest)
			return
		}

		if err != nil && !strings.Contains(err.Error(), "not found") {
			log.Printf("[Error] Physical Kubernetes deletion failed for %s/%s in %s: %v", req.ResourceKind, req.ResourceName, ns, err)
			http.Error(w, fmt.Sprintf("Kubernetes deletion failed: %v", err), http.StatusInternalServerError)
			return
		}

		log.Printf("[K8s Engine] Successfully physically deleted %s/%s from namespace %s (cluster: %s)", req.ResourceKind, req.ResourceName, ns, req.ClusterID)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "deleted",
			"clusterId":    req.ClusterID,
			"namespace":    ns,
			"resourceKind": req.ResourceKind,
			"resourceName": req.ResourceName,
			"timestamp":    time.Now().Format(time.RFC3339),
		})
	})
}

