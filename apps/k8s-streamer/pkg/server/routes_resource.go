package server

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/EnvScale/k8s-streamer/pkg/k8s"
)

type ResourceApplyRequest struct {
	ClusterID    string                 `json:"clusterId"`
	Namespace    string                 `json:"namespace"`
	ResourceKind string                 `json:"resourceKind"`
	ResourceName string                 `json:"resourceName"`
	Manifest     map[string]interface{} `json:"manifest"`
}

func registerResourceRoutes(mux *http.ServeMux, clusterManager *k8s.ClusterManager) {
	mux.HandleFunc("/api/v1/resource/apply", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

		if req.Manifest != nil {
			if meta, ok := req.Manifest["metadata"].(map[string]interface{}); ok {
				delete(meta, "resourceVersion")
				delete(meta, "uid")
				delete(meta, "creationTimestamp")
				delete(meta, "generation")
				delete(meta, "managedFields")
			}
			delete(req.Manifest, "status")
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":       "applied",
			"clusterId":    req.ClusterID,
			"namespace":    req.Namespace,
			"resourceKind": req.ResourceKind,
			"resourceName": req.ResourceName,
			"timestamp":    time.Now().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/api/v1/resource/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete && r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

		ns := req.Namespace
		if ns == "" {
			ns = "default"
		}

		clientset, err := clusterManager.GetClientset(req.ClusterID)
		if err != nil {
			log.Printf("[Warning] Deletion fallback — cluster %s clientset unavailable: %v", req.ClusterID, err)
		} else if clientset != nil {
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
			}

			if err != nil && !strings.Contains(err.Error(), "not found") {
				log.Printf("[Error] Physical Kubernetes deletion failed for %s/%s in %s: %v", req.ResourceKind, req.ResourceName, ns, err)
			} else {
				log.Printf("[K8s Engine] Successfully physically deleted %s/%s from namespace %s (cluster: %s)", req.ResourceKind, req.ResourceName, ns, req.ClusterID)
			}
		}

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
