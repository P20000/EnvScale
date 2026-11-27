package server

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/golang-jwt/jwt/v5"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

// writeAuthError writes a JSON error response for unauthenticated or unauthorized requests.
func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

// RequireAuth wraps an HTTP handler to ensure a valid JWT access token is present.
func RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := websocket.AuthenticateHandshake(r)
		if err != nil {
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}
		next(w, r)
		_ = claims
	}
}

// RequireClusterAuth wraps an HTTP handler, extracts the target cluster ID, and validates
// that the client's token grants access to that specific cluster.
func RequireClusterAuth(getClusterID func(r *http.Request) string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := websocket.AuthenticateHandshake(r)
		if err != nil {
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}

		clusterID := ""
		if getClusterID != nil {
			clusterID = getClusterID(r)
		}

		if clusterID != "" {
			if authErr := websocket.CheckClusterAuthorization(claims, clusterID); authErr != nil {
				writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster access forbidden: %v", authErr))
				return
			}
		} else if claims == nil {
			if authErr := websocket.CheckClusterAuthorization(nil, ""); authErr != nil {
				writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", authErr))
				return
			}
		}

		next(w, r)
	}
}

// RequireClusterBearerAuth enforces HTTP Bearer-header authentication (rejecting ?token= URL query parameters)
// and canonical cluster authorization while keeping browser WebSocket handshake flows unchanged.
func RequireClusterBearerAuth(getClusterID func(r *http.Request) string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := websocket.AuthenticateBearerRequest(r)
		if err != nil {
			if err == websocket.ErrMissingToken || err == websocket.ErrMissingSecret {
				if authErr := websocket.CheckUserOrServiceToken(nil); authErr == nil {
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

		if authErr := websocket.CheckUserOrServiceToken(claims); authErr != nil {
			writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster access forbidden: %v", authErr))
			return
		}

		clusterID := ""
		if getClusterID != nil {
			clusterID = getClusterID(r)
		}
		if clusterID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "clusterId is required",
				"code":  "invalid_request",
			})
			return
		}

		if authErr := websocket.CheckClusterAuthorization(claims, clusterID); authErr != nil {
			writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Cluster access forbidden: %v", authErr))
			return
		}

		next(w, r)
	}
}

// RequireClusterOperationAuth wraps an HTTP handler and enforces workspace role authorization for cluster mutations.
func RequireClusterOperationAuth(getClusterID func(r *http.Request) string, allowedRoles []string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := websocket.AuthenticateBearerRequest(r)
		if err != nil {
			if err == websocket.ErrMissingToken || err == websocket.ErrMissingSecret {
				if authErr := websocket.CheckClusterOperationAuthorization(nil, "anon-check", allowedRoles...); authErr == nil {
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

		clusterID := ""
		if getClusterID != nil {
			clusterID = getClusterID(r)
		}
		if clusterID == "" {
			writeAuthError(w, http.StatusBadRequest, "clusterId is required")
			return
		}

		if authErr := websocket.CheckClusterOperationAuthorization(claims, clusterID, allowedRoles...); authErr != nil {
			writeAuthError(w, http.StatusForbidden, fmt.Sprintf("Operation forbidden: %v", authErr))
			return
		}

		next(w, r)
	}
}

// RequireAdmin wraps an internal administrative HTTP handler (e.g. cluster register, unregister-all, rule sync)
// ensuring only authenticated internal control-plane service tokens can invoke it.
func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := websocket.AuthenticateBearerRequest(r)
		if err != nil {
			if err == websocket.ErrMissingToken || err == websocket.ErrMissingSecret {
				if authErr := websocket.CheckClusterOperationAuthorization(nil, "anon-check", "ADMIN"); authErr == nil {
					next(w, r)
					return
				}
			}
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}

		if websocket.IsServiceToken(claims) {
			next(w, r)
			return
		}

		writeAuthError(w, http.StatusForbidden, "Internal service token required (api-server or k8s-streamer)")
	}
}

// ExtractClaims extracts verified MapClaims from the request without failing if anonymous.
func ExtractClaims(r *http.Request) jwt.MapClaims {
	claims, err := websocket.AuthenticateHandshake(r)
	if err != nil {
		return nil
	}
	return claims
}
