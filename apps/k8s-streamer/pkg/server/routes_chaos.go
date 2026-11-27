package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

type ChaosInjectRequest struct {
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	FaultType string `json:"faultType"`
	Force     bool   `json:"force"`
}

type ChaosClearRequest struct {
	FaultID string `json:"faultId"`
}

func registerChaosRoutes(
	mux *http.ServeMux,
	chaosInjector *chaos.Injector,
	clusterManager *k8s.ClusterManager,
) {
	mux.HandleFunc("/api/v1/chaos/inject", RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodPost:
			var req ChaosInjectRequest
			if err := json.Unmarshal(body, &req); err != nil {
				http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
				return
			}
			if req.ClusterID == "" || req.Namespace == "" || req.Name == "" || req.FaultType == "" {
				http.Error(w, "clusterId, namespace, name, and faultType are required", http.StatusBadRequest)
				return
			}

			claims, err := websocket.AuthenticateBearerRequest(r)
			if err != nil {
				if err == websocket.ErrMissingToken || err == websocket.ErrMissingSecret {
					if authErr := websocket.CheckClusterOperationAuthorization(nil, req.ClusterID, "ADMIN"); authErr == nil {
						claims = nil
					} else {
						writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
						return
					}
				} else {
					writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
					return
				}
			}
			if authErr := websocket.CheckClusterOperationAuthorization(claims, req.ClusterID, "ADMIN"); authErr != nil {
				writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster authorization denied: %v", authErr))
				return
			}

			faultID, err := chaosInjector.InjectFault(
				r.Context(),
				req.ClusterID,
				req.Namespace,
				req.Name,
				chaos.FaultType(req.FaultType),
				req.Force,
			)
			if err != nil {
				var safetyErr *chaos.ErrPDBSafetyCheckFailed
				if errors.As(err, &safetyErr) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusServiceUnavailable)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"status":    "pdb_safety_check_failed",
						"workload":  safetyErr.Workload,
						"namespace": safetyErr.Namespace,
						"message":   safetyErr.Message,
					})
					return
				}

				var pdbErr *chaos.ErrPDBViolation
				if errors.As(err, &pdbErr) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusConflict)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"status":             "blocked_by_pdb",
						"pdbName":            pdbErr.PDBName,
						"disruptionsAllowed": pdbErr.DisruptionsAllowed,
						"workload":           pdbErr.Workload,
						"namespace":          pdbErr.Namespace,
						"message":            pdbErr.Message,
					})
					return
				}

				http.Error(w, fmt.Sprintf("Fault injection failed: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "injected",
				"faultId":   faultID,
				"faultType": req.FaultType,
				"target":    req.Name,
				"namespace": req.Namespace,
				"clusterId": req.ClusterID,
				"force":     req.Force,
			})

		case http.MethodDelete:
			var req ChaosClearRequest
			if err := json.Unmarshal(body, &req); err != nil || req.FaultID == "" {
				http.Error(w, "faultId is required in request body", http.StatusBadRequest)
				return
			}

			faultClusterID, exists := chaosInjector.GetFaultClusterID(req.FaultID)
			if !exists {
				http.Error(w, fmt.Sprintf("Fault %q not found", req.FaultID), http.StatusNotFound)
				return
			}

			claims, err := websocket.AuthenticateBearerRequest(r)
			if err != nil {
				if err == websocket.ErrMissingToken || err == websocket.ErrMissingSecret {
					if authErr := websocket.CheckClusterOperationAuthorization(nil, faultClusterID, "ADMIN"); authErr == nil {
						claims = nil
					} else {
						writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
						return
					}
				} else {
					writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
					return
				}
			}
			if authErr := websocket.CheckClusterOperationAuthorization(claims, faultClusterID, "ADMIN"); authErr != nil {
				writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster authorization denied: %v", authErr))
				return
			}

			if err := chaosInjector.ClearFault(r.Context(), req.FaultID); err != nil {
				http.Error(w, fmt.Sprintf("Failed to clear fault: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "cleared",
				"faultId": req.FaultID,
			})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/api/v1/chaos/faults", RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		clusterID := r.URL.Query().Get("clusterId")
		claims := ExtractClaims(r)
		if clusterID != "" {
			if authErr := websocket.CheckClusterAuthorization(claims, clusterID); authErr != nil {
				writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster authorization denied: %v", authErr))
				return
			}
		} else if !websocket.IsServiceToken(claims) && os.Getenv("ALLOW_ANONYMOUS_WS") != "true" {
			http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
			return
		}

		faults := chaosInjector.ListFaults(clusterID)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"activeFaults": faults,
			"total":        len(faults),
		})
	}))
}
