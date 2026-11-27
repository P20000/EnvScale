package websocket

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrMissingSecret    = errors.New("JWT_ACCESS_SECRET is not configured")
	ErrInvalidToken     = errors.New("invalid or expired JWT token")
	ErrUnexpectedMethod = errors.New("unexpected signing method")
	ErrMissingToken     = errors.New("authentication token is required")
)

func isProductionEnv() bool {
	envMode := os.Getenv("NODE_ENV")
	if envMode == "" {
		envMode = os.Getenv("ENV")
	}
	return envMode == "production" || os.Getenv("GIN_MODE") == "release"
}

func isAnonymousAllowed() bool {
	return !isProductionEnv() && os.Getenv("ALLOW_ANONYMOUS_WS") == "true"
}

// CheckEnvironmentAuthConfig validates authentication and CORS env vars.
// Returns an error in production if secrets are missing/weak/placeholder or unsafe wildcards/bypass flags are enabled.
func CheckEnvironmentAuthConfig() error {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	isProduction := isProductionEnv()
	allowAnonymous := os.Getenv("ALLOW_ANONYMOUS_WS") == "true"

	if isProduction {
		if secret == "" {
			return fmt.Errorf("JWT_ACCESS_SECRET is missing in production environment")
		}
		if len(secret) < 32 {
			return fmt.Errorf("JWT_ACCESS_SECRET must be at least 32 characters in production")
		}
		if secret == "default_dev_access_secret_do_not_use_in_prod" ||
			secret == "replace-with-a-long-random-access-secret" {
			return fmt.Errorf("JWT_ACCESS_SECRET uses a known placeholder secret in production")
		}
		if allowAnonymous {
			return fmt.Errorf("ALLOW_ANONYMOUS_WS=true is prohibited in production")
		}
		corsOrigin := os.Getenv("CORS_ORIGIN")
		if corsOrigin == "" {
			corsOrigin = os.Getenv("ALLOWED_ORIGINS")
		}
		if strings.Contains(corsOrigin, "*") {
			return fmt.Errorf("CORS_ORIGIN cannot contain wildcard '*' in production")
		}
	}

	return nil
}

// ValidateEnvironmentAuthConfig validates authentication environment variable configuration at boot/startup.
// Fails immediately (log.Fatal) if running in production with invalid security configuration.
func ValidateEnvironmentAuthConfig() {
	if err := CheckEnvironmentAuthConfig(); err != nil {
		log.Fatalf("[Auth Error] Critical Security Exception: %v. Process halted to prevent security bypass!", err)
	}

	secret := os.Getenv("JWT_ACCESS_SECRET")
	allowAnonymous := isAnonymousAllowed()
	if secret == "" {
		if !allowAnonymous {
			log.Println("[Auth Config Warning] JWT_ACCESS_SECRET is unset. WebSocket connections will fail authentication unless ALLOW_ANONYMOUS_WS=true is set for local dev.")
		} else {
			log.Println("[Auth Config Warning] ALLOW_ANONYMOUS_WS=true enabled. Unauthenticated local dev WebSocket connections permitted.")
		}
	} else {
		log.Println("[Auth System] JWT Access Secret loaded successfully — HMAC signature validation active for WebSocket handshake.")
	}
}

// ValidateJWTToken parses and validates a raw JWT token string using the configured HMAC secret.
func ValidateJWTToken(tokenStr string) (jwt.MapClaims, error) {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	if secret == "" {
		return nil, ErrMissingSecret
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("%w: %v", ErrUnexpectedMethod, token.Header["alg"])
		}
		return []byte(secret), nil
	})

	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// AuthenticateBearerRequest extracts and validates a JWT strictly from the Authorization: Bearer header.
// Rejects URL query-parameter tokens to prevent credential leakage in access logs and URLs.
func AuthenticateBearerRequest(r *http.Request) (jwt.MapClaims, error) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") || len(authHeader) <= 7 {
		return nil, ErrMissingToken
	}
	return ValidateJWTToken(strings.TrimSpace(authHeader[7:]))
}

// AuthenticateRequest extracts and validates the JWT Bearer token from the HTTP Authorization header or token query.
func AuthenticateRequest(r *http.Request) (jwt.MapClaims, error) {
	authHeader := r.Header.Get("Authorization")
	var tokenStr string
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenStr = authHeader[7:]
	} else {
		tokenStr = r.URL.Query().Get("token")
	}

	if tokenStr == "" {
		return nil, ErrMissingToken
	}

	return ValidateJWTToken(tokenStr)
}

// AuthenticateHandshake validates the JWT token passed via URL query parameter ('token') or Authorization header.
// Enforces strict HMAC algorithm signature validation to prevent algorithm confusion attacks.
// Returns the validated MapClaims on success.
func AuthenticateHandshake(r *http.Request) (jwt.MapClaims, error) {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	allowAnonymous := isAnonymousAllowed()

	if secret == "" && allowAnonymous {
		return nil, nil
	}

	claims, err := AuthenticateRequest(r)
	if err != nil && allowAnonymous && (errors.Is(err, ErrMissingToken) || errors.Is(err, ErrMissingSecret)) {
		return nil, nil // Permitted in local dev mode when ALLOW_ANONYMOUS_WS=true and no token is presented
	}

	return claims, err
}

// IsServiceToken verifies whether the claims represent an authenticated internal service identity.
func IsServiceToken(claims jwt.MapClaims) bool {
	if claims == nil {
		return false
	}
	sub, _ := claims["sub"].(string)
	if sub != "api-server" && sub != "k8s-streamer" {
		return false
	}
	tokenType, ok := claims["tokenType"].(string)
	return ok && tokenType == "service"
}

func extractClusterRole(claims jwt.MapClaims, clusterID string) (string, bool) {
	if claims == nil || clusterID == "" {
		return "", false
	}
	rawRoles, exists := claims["clusterRoles"]
	if !exists || rawRoles == nil {
		return "", false
	}
	switch roleMap := rawRoles.(type) {
	case map[string]interface{}:
		if v, ok := roleMap[clusterID]; ok {
			if roleStr, ok := v.(string); ok && roleStr != "" {
				return strings.ToUpper(roleStr), true
			}
		}
	case map[string]string:
		if roleStr, ok := roleMap[clusterID]; ok && roleStr != "" {
			return strings.ToUpper(roleStr), true
		}
	}
	return "", false
}

func rejectNonUserTokenType(claims jwt.MapClaims) error {
	if IsServiceToken(claims) {
		return nil
	}
	tokenType, ok := claims["tokenType"].(string)
	if !ok || tokenType != "user" {
		return fmt.Errorf("token type %q is not permitted for user cluster access", tokenType)
	}
	return nil
}

// CheckUserOrServiceToken verifies that claims belong to a user or internal service token (rejecting agent/scoped tokens).
func CheckUserOrServiceToken(claims jwt.MapClaims) error {
	if claims == nil {
		if isAnonymousAllowed() {
			return nil
		}
		return ErrMissingToken
	}
	return rejectNonUserTokenType(claims)
}

// CheckClusterAuthorization verifies whether the provided claims permit read/stream access to clusterID.
// Fails closed when claims are absent or lack explicit authorization for the target cluster UUID.
func CheckClusterAuthorization(claims jwt.MapClaims, clusterID string) error {
	if claims == nil {
		if isAnonymousAllowed() {
			return nil
		}
		return ErrMissingToken
	}

	if err := rejectNonUserTokenType(claims); err != nil {
		return err
	}

	if IsServiceToken(claims) {
		return nil
	}

	if clusterID == "" || clusterID == "*" {
		return fmt.Errorf("valid canonical clusterId is required for cluster access")
	}

	if role, ok := extractClusterRole(claims, clusterID); ok {
		if role == "ADMIN" || role == "MEMBER" || role == "VIEWER" {
			return nil
		}
		return fmt.Errorf("user %v has unsupported cluster role %q for cluster %s", claims["sub"], role, clusterID)
	}

	if rawClusters, exists := claims["allowedClusterIds"]; exists && rawClusters != nil {
		switch clusterList := rawClusters.(type) {
		case []interface{}:
			for _, item := range clusterList {
				if str, ok := item.(string); ok && str != "*" && str == clusterID {
					return nil
				}
			}
		case []string:
			for _, str := range clusterList {
				if str != "*" && str == clusterID {
					return nil
				}
			}
		}
	}

	return fmt.Errorf("user %v is not authorized to access cluster %s", claims["sub"], clusterID)
}

// CheckClusterOperationAuthorization enforces workspace role authorization (e.g. ADMIN) for cluster operations.
func CheckClusterOperationAuthorization(claims jwt.MapClaims, clusterID string, allowedRoles ...string) error {
	if claims == nil {
		if isAnonymousAllowed() {
			return nil
		}
		return ErrMissingToken
	}

	if err := rejectNonUserTokenType(claims); err != nil {
		return err
	}

	if IsServiceToken(claims) {
		return nil
	}

	role, ok := extractClusterRole(claims, clusterID)
	if !ok {
		return fmt.Errorf("user %v lacks workspace role authorization for cluster %s", claims["sub"], clusterID)
	}

	for _, allowed := range allowedRoles {
		if role == strings.ToUpper(allowed) {
			return nil
		}
	}

	return fmt.Errorf("role %q is insufficient for operation on cluster %s", role, clusterID)
}

// CheckAgentAuthorization binds an inbound /ws/agent connection strictly to an agent token for clusterID.
func CheckAgentAuthorization(claims jwt.MapClaims, clusterID string) error {
	if claims == nil {
		if isAnonymousAllowed() {
			return nil
		}
		return ErrMissingToken
	}

	tokenType, _ := claims["tokenType"].(string)
	if tokenType != "agent" {
		return fmt.Errorf("agent tokenType required for /ws/agent, got %q", tokenType)
	}

	boundClusterID, _ := claims["clusterId"].(string)
	if boundClusterID == "" || boundClusterID != clusterID {
		return fmt.Errorf("agent token is not bound to cluster %s", clusterID)
	}

	return nil
}

// AuthorizedClusterIDs returns the set of cluster UUIDs the token is authorized for, and whether it is a service token.
func AuthorizedClusterIDs(claims jwt.MapClaims) (map[string]bool, bool) {
	if claims == nil {
		return nil, false
	}
	if IsServiceToken(claims) {
		return nil, true
	}
	if err := rejectNonUserTokenType(claims); err != nil {
		return map[string]bool{}, false
	}

	out := make(map[string]bool)
	if rawRoles, exists := claims["clusterRoles"]; exists && rawRoles != nil {
		switch roleMap := rawRoles.(type) {
		case map[string]interface{}:
			for k := range roleMap {
				if k != "" && k != "*" {
					out[k] = true
				}
			}
		case map[string]string:
			for k := range roleMap {
				if k != "" && k != "*" {
					out[k] = true
				}
			}
		}
	}
	if rawClusters, exists := claims["allowedClusterIds"]; exists && rawClusters != nil {
		switch clusterList := rawClusters.(type) {
		case []interface{}:
			for _, item := range clusterList {
				if str, ok := item.(string); ok && str != "" && str != "*" {
					out[str] = true
				}
			}
		case []string:
			for _, str := range clusterList {
				if str != "" && str != "*" {
					out[str] = true
				}
			}
		}
	}
	return out, false
}

// CreateServiceToken generates a short-lived administrative service token
// signed with JWT_ACCESS_SECRET for internal inter-service communication (e.g. streamer -> api-server).
func CreateServiceToken() (string, error) {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	if secret == "" {
		return "", ErrMissingSecret
	}
	claims := jwt.MapClaims{
		"sub":               "k8s-streamer",
		"role":              "SERVICE",
		"tokenType":         "service",
		"allowedClusterIds": []string{"*"},
		"exp":               time.Now().Add(15 * time.Minute).Unix(),
		"iat":               time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}


