package server

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/EnvScale/k8s-streamer/pkg/executor"
)

func registerExecutorRoutes(mux *http.ServeMux, executorFactory *executor.ClusterExecutorFactory) {
	mux.HandleFunc("/api/v1/clusters/snapshot", RequireClusterBearerAuth(func(r *http.Request) string {
		return r.URL.Query().Get("clusterId")
	}, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{
				"error": "Method not allowed",
				"code":  "method_not_allowed",
			})
			return
		}

		clusterID := r.URL.Query().Get("clusterId")
		if clusterID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"error": "clusterId query parameter is required",
				"code":  "invalid_request",
			})
			return
		}

		snapshot, err := executorFactory.GetSnapshot(r.Context(), clusterID)
		if err != nil {
			writeExecutorError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, snapshot)
	}))

	mux.HandleFunc("/api/v1/clusters/{clusterId}/capabilities", RequireClusterBearerAuth(func(r *http.Request) string {
		return r.PathValue("clusterId")
	}, func(w http.ResponseWriter, r *http.Request) {
		handleCapabilitiesRequest(w, r, executorFactory, r.PathValue("clusterId"))
	}))

	mux.HandleFunc("/api/v1/clusters/capabilities", RequireClusterBearerAuth(func(r *http.Request) string {
		return r.URL.Query().Get("clusterId")
	}, func(w http.ResponseWriter, r *http.Request) {
		handleCapabilitiesRequest(w, r, executorFactory, r.URL.Query().Get("clusterId"))
	}))
}

func handleCapabilitiesRequest(w http.ResponseWriter, r *http.Request, executorFactory *executor.ClusterExecutorFactory, clusterID string) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{
			"error": "Method not allowed",
			"code":  "method_not_allowed",
		})
		return
	}
	if clusterID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "clusterId is required",
			"code":  "invalid_request",
		})
		return
	}

	forceRefresh := r.URL.Query().Get("refresh") == "true"
	caps, err := executorFactory.CapabilitiesWithRefresh(r.Context(), clusterID, forceRefresh)
	if err != nil {
		writeExecutorError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, caps)
}

func writeExecutorError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "internal_error"

	switch {
	case errors.Is(err, executor.ErrClusterNotFound):
		status = http.StatusNotFound
		code = "cluster_not_found"
	case errors.Is(err, executor.ErrClusterDisconnected):
		status = http.StatusServiceUnavailable
		code = "cluster_disconnected"
	case errors.Is(err, executor.ErrClusterUnreachable):
		status = http.StatusServiceUnavailable
		code = "cluster_unreachable"
	case errors.Is(err, executor.ErrPermissionDenied):
		status = http.StatusForbidden
		code = "permission_denied"
	case errors.Is(err, executor.ErrCapabilityUnsupported):
		status = http.StatusNotImplemented
		code = "capability_unsupported"
	case errors.Is(err, executor.ErrCommandTimeout), errors.Is(err, executor.ErrCommandExpired):
		status = http.StatusGatewayTimeout
		code = "command_timeout"
	}

	writeJSON(w, status, map[string]string{
		"error": err.Error(),
		"code":  code,
	})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
