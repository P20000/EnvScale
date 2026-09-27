package websocket

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrMissingSecret    = errors.New("JWT_ACCESS_SECRET is not configured")
	ErrInvalidToken     = errors.New("invalid or expired JWT token")
	ErrUnexpectedMethod = errors.New("unexpected signing method")
	ErrMissingToken     = errors.New("authentication token is required")
)

// ValidateEnvironmentAuthConfig validates authentication environment variable configuration at boot/startup.
// Fails immediately (log.Fatal) if running in production without JWT_ACCESS_SECRET.
func ValidateEnvironmentAuthConfig() {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	envMode := os.Getenv("NODE_ENV")
	if envMode == "" {
		envMode = os.Getenv("ENV")
	}

	isProduction := envMode == "production" || os.Getenv("GIN_MODE") == "release"
	allowAnonymous := os.Getenv("ALLOW_ANONYMOUS_WS") == "true"

	if secret == "" {
		if isProduction {
			log.Fatal("[Auth Error] Critical Security Exception: JWT_ACCESS_SECRET is missing in production environment. Process halted to prevent fail-open security bypass!")
		} else if !allowAnonymous {
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
func AuthenticateHandshake(r *http.Request) error {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	allowAnonymous := os.Getenv("ALLOW_ANONYMOUS_WS") == "true"

	if secret == "" && allowAnonymous {
		return nil
	}

	_, err := AuthenticateRequest(r)
	if err != nil && allowAnonymous && (errors.Is(err, ErrMissingToken) || errors.Is(err, ErrMissingSecret)) {
		return nil // Permitted in local dev mode when ALLOW_ANONYMOUS_WS=true
	}

	return err
}

