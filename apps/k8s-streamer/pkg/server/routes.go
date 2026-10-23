package server

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/chaos"
	"github.com/EnvScale/k8s-streamer/pkg/k8s"
	envredis "github.com/EnvScale/k8s-streamer/pkg/redis"
	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

type RegisterClusterRequest struct {
	ClusterID       string `json:"clusterId"`
	ClusterName     string `json:"clusterName,omitempty"`
	Kubeconfig      string `json:"kubeconfig"`
	IsInClusterMode bool   `json:"isInClusterMode"`
}

type LogStreamRequest struct {
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	PodName   string `json:"podName"`
	Container string `json:"container"`
	TailLines int64  `json:"tailLines"`
}

func SetupRoutes(
	mux *http.ServeMux,
	hub *websocket.Hub,
	clusterManager *k8s.ClusterManager,
	logStreamer *k8s.PodLogStreamer,
	chaosInjector *chaos.Injector,
	metricEvaluator *k8s.MetricEvaluator,
	redisAdapter *envredis.Adapter,
) {
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		redisStatus := "disabled"
		if redisAdapter != nil && redisAdapter.IsRunning() {
			redisStatus = "connected"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":           "ok",
			"service":          "k8s-streamer",
			"activeClients":    hub.ClientCount(),
			"activeClusters":   clusterManager.ActiveClusterCount(),
			"activeLogStreams": logStreamer.ActiveStreamCount(),
			"activeChaosOps":   chaosInjector.ActiveFaultCount(),
			"activeAlertRules": metricEvaluator.RuleCount(),
			"redisStatus":      redisStatus,
			"timestamp":        time.Now().UTC().Format(time.RFC3339),
		})
	})

	mux.HandleFunc("/ws/k8s", func(w http.ResponseWriter, r *http.Request) {
		clientID := r.URL.Query().Get("clientId")
		if clientID == "" {
			clientID = fmt.Sprintf("client-%d", time.Now().UnixNano())
		}
		websocket.ServeWs(hub, clientID, w, r)
	})

	mux.HandleFunc("/ws/agent", func(w http.ResponseWriter, r *http.Request) {
		HandleAgentWebSocket(hub, clusterManager, w, r)
	})

	mux.HandleFunc("/api/v1/stream/logs", func(w http.ResponseWriter, r *http.Request) {
		HandleUniversalLogStream(clusterManager, w, r)
	})
	mux.HandleFunc("/ws/logs", func(w http.ResponseWriter, r *http.Request) {
		HandleUniversalLogStream(clusterManager, w, r)
	})
	mux.HandleFunc("/ws/stream/logs", func(w http.ResponseWriter, r *http.Request) {
		HandleUniversalLogStream(clusterManager, w, r)
	})

	setupRollbackRoutes(mux, clusterManager, hub)

	mux.HandleFunc("/api/v1/clusters/register", RequireAdmin(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		var req RegisterClusterRequest
		if err := json.Unmarshal(body, &req); err != nil || req.ClusterID == "" {
			http.Error(w, "Invalid payload: clusterId is required", http.StatusBadRequest)
			return
		}

		if req.IsInClusterMode {
			if err := clusterManager.RegisterInCluster(req.ClusterID); err != nil {
				http.Error(w, fmt.Sprintf("Failed to register in-cluster: %v", err), http.StatusInternalServerError)
				return
			}
			if req.ClusterName != "" {
				clusterManager.RegisterClusterAlias(req.ClusterID, req.ClusterName)
			}
		} else {
			if req.Kubeconfig == "" {
				http.Error(w, "kubeconfig is required when not in cluster mode", http.StatusBadRequest)
				return
			}

			rawKubeconfig := []byte(req.Kubeconfig)
			if decoded, err := base64.StdEncoding.DecodeString(req.Kubeconfig); err == nil && len(decoded) > 0 {
				rawKubeconfig = decoded
			}

			if err := clusterManager.RegisterCluster(req.ClusterID, rawKubeconfig); err != nil {
				http.Error(w, fmt.Sprintf("Failed to register cluster: %v", err), http.StatusBadRequest)
				return
			}
			if req.ClusterName != "" {
				clusterManager.RegisterClusterAlias(req.ClusterID, req.ClusterName)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":    "registered",
			"clusterId": req.ClusterID,
		})
	}))

	mux.HandleFunc("/api/v1/clusters/snapshot", RequireClusterAuth(func(r *http.Request) string {
		return r.URL.Query().Get("clusterId")
	}, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		clusterID := r.URL.Query().Get("clusterId")
		if clusterID == "" {
			http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
			return
		}

		pods, nodes, services, deployments, replicaSets, statefulSets, daemonSets, ingresses, incidents, cronJobs, jobs, pvcs, pvs, configMaps, secrets, err := clusterManager.GetClusterSnapshot(clusterID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		hpas := clusterManager.GetHPASnapshot(clusterID)
		networkPolicies := clusterManager.GetNetworkPolicySnapshot(clusterID)
		pdbs := clusterManager.GetPDBSnapshot(clusterID)
		resourceQuotas := clusterManager.GetResourceQuotaSnapshot(clusterID)
		limitRanges := clusterManager.GetLimitRangeSnapshot(clusterID)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"pods":            pods,
			"nodes":           nodes,
			"services":        services,
			"deployments":     deployments,
			"replicaSets":     replicaSets,
			"statefulSets":    statefulSets,
			"daemonSets":      daemonSets,
			"ingresses":       ingresses,
			"incidents":       incidents,
			"cronJobs":        cronJobs,
			"jobs":            jobs,
			"pvcs":            pvcs,
			"pvs":             pvs,
			"configMaps":      configMaps,
			"secrets":         secrets,
			"hpas":            hpas,
			"networkPolicies": networkPolicies,
			"pdbs":            pdbs,
			"resourceQuotas":  resourceQuotas,
			"limitRanges":     limitRanges,
			"metricsHistory":  clusterManager.GetMetricsHistory(clusterID),
		})
	}))

	mux.HandleFunc("/api/v1/clusters/metrics/history", RequireClusterAuth(func(r *http.Request) string {
		return r.URL.Query().Get("clusterId")
	}, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		clusterID := r.URL.Query().Get("clusterId")
		if clusterID == "" {
			http.Error(w, "clusterId query parameter is required", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"clusterId": clusterID,
			"history":   clusterManager.GetMetricsHistory(clusterID),
		})
	}))

	mux.HandleFunc("/api/v1/clusters", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			RequireAuth(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"clusters": clusterManager.ListClusters(),
					"total":    clusterManager.ActiveClusterCount(),
				})
			})(w, r)
			return
		}

		if r.Method == http.MethodDelete {
			RequireClusterAuth(func(r *http.Request) string {
				return r.URL.Query().Get("clusterId")
			}, func(w http.ResponseWriter, r *http.Request) {
				clusterID := r.URL.Query().Get("clusterId")
				if clusterID == "" {
					http.Error(w, "clusterId query parameter required", http.StatusBadRequest)
					return
				}

				if err := clusterManager.UnregisterCluster(clusterID); err != nil {
					http.Error(w, err.Error(), http.StatusNotFound)
					return
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status":    "unregistered",
					"clusterId": clusterID,
				})
			})(w, r)
			return
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/v1/clusters/unregister-all", RequireAdmin(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost && r.Method != http.MethodDelete {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		clusterManager.UnregisterAllClusters()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "all_unregistered",
		})
	}))

	mux.HandleFunc("/api/v1/logs/stream", RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request body", http.StatusBadRequest)
			return
		}

		var req LogStreamRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}
		if req.ClusterID == "" || req.Namespace == "" || req.PodName == "" {
			http.Error(w, "clusterId, namespace, and podName are required", http.StatusBadRequest)
			return
		}

		claims := ExtractClaims(r)
		if authErr := websocket.CheckClusterAuthorization(claims, req.ClusterID); authErr != nil {
			writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster authorization denied: %v", authErr))
			return
		}

		switch r.Method {
		case http.MethodPost:
			im, ok := clusterManager.GetCluster(req.ClusterID)
			if !ok {
				http.Error(w, fmt.Sprintf("cluster '%s' is not registered", req.ClusterID), http.StatusNotFound)
				return
			}

			tailLines := req.TailLines
			if tailLines <= 0 {
				tailLines = 100
			}

			if err := logStreamer.StartStream(
				r.Context(),
				im.Clientset(),
				req.ClusterID, req.Namespace, req.PodName, req.Container,
				tailLines,
			); err != nil {
				http.Error(w, fmt.Sprintf("Failed to start log stream: %v", err), http.StatusInternalServerError)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "streaming",
				"clusterId": req.ClusterID,
				"namespace": req.Namespace,
				"pod":       req.PodName,
				"container": req.Container,
			})

		case http.MethodDelete:
			logStreamer.StopStream(req.ClusterID, req.Namespace, req.PodName, req.Container)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":    "stopped",
				"clusterId": req.ClusterID,
				"namespace": req.Namespace,
				"pod":       req.PodName,
			})

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	registerChaosRoutes(mux, chaosInjector, clusterManager)

	mux.HandleFunc("/api/v1/evaluator/rules", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			RequireAuth(func(w http.ResponseWriter, r *http.Request) {
				rules := metricEvaluator.ListRules()
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"rules": rules,
					"total": len(rules),
				})
			})(w, r)

		case http.MethodPost:
			RequireAdmin(func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				if err != nil {
					http.Error(w, "Failed to read request body", http.StatusBadRequest)
					return
				}

				var rules []k8s.AlertRule
				if err := json.Unmarshal(body, &rules); err == nil {
					metricEvaluator.SetRules(rules)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"status": "rules_synced",
						"count":  len(rules),
					})
					return
				}

				var singleRule k8s.AlertRule
				if err := json.Unmarshal(body, &singleRule); err == nil && singleRule.RuleID != "" {
					metricEvaluator.AddRule(singleRule)
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					json.NewEncoder(w).Encode(map[string]interface{}{
						"status": "rule_added",
						"ruleId": singleRule.RuleID,
					})
					return
				}

				http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			})(w, r)

		case http.MethodDelete:
			RequireAdmin(func(w http.ResponseWriter, r *http.Request) {
				ruleID := r.URL.Query().Get("ruleId")
				if ruleID == "" {
					http.Error(w, "ruleId query parameter required", http.StatusBadRequest)
					return
				}

				removed := metricEvaluator.RemoveRule(ruleID)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status":  "deleted",
					"ruleId":  ruleID,
					"success": removed,
				})
			})(w, r)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})


	registerResourceRoutes(mux, clusterManager)
}
