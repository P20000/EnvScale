package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

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
		allowAnonymous := os.Getenv("ALLOW_ANONYMOUS_WS") == "true"
		claims, err := websocket.AuthenticateHandshake(r)
		if err != nil {
			if allowAnonymous {
				next(w, r)
				return
			}
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}
		if claims == nil && !allowAnonymous {
			writeAuthError(w, http.StatusUnauthorized, "Authentication required: missing token")
			return
		}
		next(w, r)
	}
}

// RequireClusterAuth wraps an HTTP handler, extracts the target cluster ID, and validates
// that the client's token grants access to that specific cluster.
func RequireClusterAuth(getClusterID func(r *http.Request) string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allowAnonymous := os.Getenv("ALLOW_ANONYMOUS_WS") == "true"
		claims, err := websocket.AuthenticateHandshake(r)
		if err != nil {
			if allowAnonymous {
				next(w, r)
				return
			}
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}
		if claims == nil && !allowAnonymous {
			writeAuthError(w, http.StatusUnauthorized, "Authentication required: missing token")
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
		}

		next(w, r)
	}
}

// RequireAdmin wraps an administrative HTTP handler (e.g. unregister-all, rule sync)
// ensuring only callers with ADMIN or SUPER_ADMIN roles or api-server service identity can invoke it.
func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		allowAnonymous := os.Getenv("ALLOW_ANONYMOUS_WS") == "true"
		claims, err := websocket.AuthenticateHandshake(r)
		if err != nil {
			if allowAnonymous {
				next(w, r)
				return
			}
			writeAuthError(w, http.StatusUnauthorized, fmt.Sprintf("Authentication required: %v", err))
			return
		}

		if claims == nil && allowAnonymous {
			next(w, r)
			return
		}

		if sub, ok := claims["sub"].(string); ok && sub == "api-server" {
			next(w, r)
			return
		}

		if role, ok := claims["role"].(string); ok && (role == "ADMIN" || role == "SUPER_ADMIN") {
			next(w, r)
			return
		}

		if allowAnonymous {
			next(w, r)
			return
		}

		writeAuthError(w, http.StatusForbidden, "Administrative privileges required (ADMIN, SUPER_ADMIN, or api-server service token)")
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
