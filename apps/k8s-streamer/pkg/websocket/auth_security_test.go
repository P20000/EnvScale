package websocket

import (
	"net/http/httptest"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestCheckClusterAuthorization_FailsClosedWhenClaimsEmptyOrMissingCluster(t *testing.T) {
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	// SEC-C1: Token without allowedClusterIds or clusterRoles must be rejected
	claimsWithoutClusters := jwt.MapClaims{
		"sub":       "user-1",
		"role":      "user",
		"tokenType": "user",
	}
	if err := CheckClusterAuthorization(claimsWithoutClusters, "cluster-victim"); err == nil {
		t.Fatalf("expected error for JWT lacking clusterRoles/allowedClusterIds, got nil (fail-open)")
	}

	// SEC-H3: Global ADMIN without cluster membership must NOT bypass tenant isolation
	globalAdmin := jwt.MapClaims{
		"sub":       "admin-1",
		"role":      "ADMIN",
		"tokenType": "user",
	}
	if err := CheckClusterAuthorization(globalAdmin, "cluster-victim"); err == nil {
		t.Fatalf("expected error for global ADMIN lacking cluster membership, got nil")
	}

	// SEC-C1/SEC-H3: Wildcard "*" in allowedClusterIds must NOT be accepted for user tokens
	wildcardUser := jwt.MapClaims{
		"sub":               "user-1",
		"tokenType":         "user",
		"allowedClusterIds": []interface{}{"*"},
	}
	if err := CheckClusterAuthorization(wildcardUser, "cluster-victim"); err == nil {
		t.Fatalf("expected error for user token with wildcard allowedClusterIds, got nil")
	}

	// SEC-C2: Agent token must NOT pass user cluster authorization
	agentToken := jwt.MapClaims{
		"sub":       "agent-cluster-1",
		"tokenType": "agent",
		"clusterId": "cluster-1",
	}
	if err := CheckClusterAuthorization(agentToken, "cluster-1"); err == nil {
		t.Fatalf("expected error for agent token attempting user cluster access, got nil")
	}

	// Valid user with VIEWER role in clusterRoles may read
	viewerClaims := jwt.MapClaims{
		"sub":       "viewer-1",
		"tokenType": "user",
		"clusterRoles": map[string]interface{}{
			"cluster-1": "VIEWER",
		},
	}
	if err := CheckClusterAuthorization(viewerClaims, "cluster-1"); err != nil {
		t.Fatalf("expected VIEWER to have read access to cluster-1, got: %v", err)
	}
	if err := CheckClusterAuthorization(viewerClaims, "cluster-2"); err == nil {
		t.Fatalf("expected VIEWER to be denied access to cluster-2")
	}
}

func TestCheckClusterOperationAuthorization_EnforcesRoles(t *testing.T) {
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	viewerClaims := jwt.MapClaims{
		"sub":       "viewer-1",
		"tokenType": "user",
		"clusterRoles": map[string]interface{}{
			"cluster-1": "VIEWER",
		},
	}
	if err := CheckClusterOperationAuthorization(viewerClaims, "cluster-1", "ADMIN", "MEMBER"); err == nil {
		t.Fatalf("expected VIEWER to be blocked from operational mutation")
	}

	memberClaims := jwt.MapClaims{
		"sub":       "member-1",
		"tokenType": "user",
		"clusterRoles": map[string]interface{}{
			"cluster-1": "MEMBER",
		},
	}
	if err := CheckClusterOperationAuthorization(memberClaims, "cluster-1", "ADMIN", "MEMBER"); err != nil {
		t.Fatalf("expected MEMBER to be allowed operational mutation, got: %v", err)
	}
	if err := CheckClusterOperationAuthorization(memberClaims, "cluster-1", "ADMIN"); err == nil {
		t.Fatalf("expected MEMBER to be blocked from ADMIN-only operation")
	}

	// Agent token must be rejected from operational mutations
	agentClaims := jwt.MapClaims{
		"sub":       "agent-cluster-1",
		"tokenType": "agent",
		"clusterId": "cluster-1",
		"role":      "MEMBER",
	}
	if err := CheckClusterOperationAuthorization(agentClaims, "cluster-1", "ADMIN", "MEMBER"); err == nil {
		t.Fatalf("expected agent token to be blocked from user operational mutations")
	}

	// Internal service token is allowed
	svcClaims := jwt.MapClaims{
		"sub":       "api-server",
		"tokenType": "service",
		"role":      "SERVICE",
	}
	if err := CheckClusterOperationAuthorization(svcClaims, "cluster-1", "ADMIN"); err != nil {
		t.Fatalf("expected service token to be allowed, got: %v", err)
	}
}

func TestCheckAgentAuthorization_StrictBinding(t *testing.T) {
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	userClaims := jwt.MapClaims{
		"sub":       "user-1",
		"tokenType": "user",
		"clusterRoles": map[string]interface{}{
			"cluster-a": "ADMIN",
		},
	}
	if err := CheckAgentAuthorization(userClaims, "cluster-a"); err == nil {
		t.Fatalf("expected user token to be rejected on /ws/agent")
	}

	otherAgent := jwt.MapClaims{
		"sub":       "agent-cluster-a",
		"tokenType": "agent",
		"clusterId": "cluster-a",
	}
	if err := CheckAgentAuthorization(otherAgent, "cluster-b"); err == nil {
		t.Fatalf("expected agent token for cluster-a to be rejected for cluster-b")
	}
	if err := CheckAgentAuthorization(otherAgent, "cluster-a"); err != nil {
		t.Fatalf("expected matching agent token for cluster-a to succeed, got: %v", err)
	}
}

func TestIsOriginAllowed_StrictValidation(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("CORS_ORIGIN", "https://envscale.duckdns.org")

	// SEC-H2: Arbitrary *.duckdns.org must be rejected
	evilReq := httptest.NewRequest("GET", "/ws/k8s", nil)
	evilReq.Host = "envscale.duckdns.org"
	evilReq.Header.Set("Origin", "https://attacker-evil.duckdns.org")
	if IsOriginAllowed(evilReq) {
		t.Fatalf("SEC-H2: arbitrary *.duckdns.org origin must be rejected")
	}

	// SEC-H2: X-Forwarded-Host must NOT be trusted
	fwdReq := httptest.NewRequest("GET", "/ws/k8s", nil)
	fwdReq.Host = "envscale.duckdns.org"
	fwdReq.Header.Set("X-Forwarded-Host", "spoofed.example.com")
	fwdReq.Header.Set("Origin", "https://spoofed.example.com")
	if IsOriginAllowed(fwdReq) {
		t.Fatalf("SEC-H2: X-Forwarded-Host spoofed origin must be rejected")
	}

	// SEC-H2: Wildcard "*" in production CORS_ORIGIN must NOT open all origins
	t.Setenv("CORS_ORIGIN", "*")
	if IsOriginAllowed(evilReq) {
		t.Fatalf("SEC-H2: wildcard CORS_ORIGIN must be rejected in production")
	}

	// Configured exact origin is permitted
	t.Setenv("CORS_ORIGIN", "https://envscale.duckdns.org")
	goodReq := httptest.NewRequest("GET", "/ws/k8s", nil)
	goodReq.Host = "envscale.duckdns.org"
	goodReq.Header.Set("Origin", "https://envscale.duckdns.org")
	if !IsOriginAllowed(goodReq) {
		t.Fatalf("expected exact configured origin to be permitted")
	}
}

func TestIsServiceToken_AndTokenTypeAllowlist(t *testing.T) {
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")

	legacyService := jwt.MapClaims{
		"sub":  "api-server",
		"role": "ADMIN",
	}
	if IsServiceToken(legacyService) {
		t.Fatalf("expected legacy token without tokenType=='service' to be rejected by IsServiceToken")
	}

	unknownType := jwt.MapClaims{
		"sub":       "user-1",
		"tokenType": "refresh",
		"clusterRoles": map[string]interface{}{
			"cluster-1": "ADMIN",
		},
	}
	if err := CheckClusterAuthorization(unknownType, "cluster-1"); err == nil {
		t.Fatalf("expected unknown tokenType to be rejected")
	}

	missingType := jwt.MapClaims{
		"sub": "user-1",
		"clusterRoles": map[string]interface{}{
			"cluster-1": "ADMIN",
		},
	}
	if err := CheckClusterAuthorization(missingType, "cluster-1"); err == nil {
		t.Fatalf("expected missing tokenType to be rejected")
	}
}

func TestCheckEnvironmentAuthConfig_ProductionGuardrails(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("ALLOW_ANONYMOUS_WS", "false")
	t.Setenv("CORS_ORIGIN", "https://app.envscale.dev")
	t.Setenv("JWT_ACCESS_SECRET", "short-secret")
	if err := CheckEnvironmentAuthConfig(); err == nil {
		t.Fatalf("expected short JWT_ACCESS_SECRET in production to fail")
	}

	t.Setenv("JWT_ACCESS_SECRET", "default_dev_access_secret_do_not_use_in_prod")
	if err := CheckEnvironmentAuthConfig(); err == nil {
		t.Fatalf("expected placeholder JWT_ACCESS_SECRET in production to fail")
	}

	t.Setenv("JWT_ACCESS_SECRET", "0123456789abcdef0123456789abcdef")
	t.Setenv("ALLOW_ANONYMOUS_WS", "true")
	if err := CheckEnvironmentAuthConfig(); err == nil {
		t.Fatalf("expected ALLOW_ANONYMOUS_WS=true in production to fail")
	}

	t.Setenv("ALLOW_ANONYMOUS_WS", "false")
	t.Setenv("CORS_ORIGIN", "https://*.envscale.dev")
	if err := CheckEnvironmentAuthConfig(); err == nil {
		t.Fatalf("expected wildcard CORS_ORIGIN in production to fail")
	}

	t.Setenv("CORS_ORIGIN", "https://envscale.duckdns.org")
	if err := CheckEnvironmentAuthConfig(); err != nil {
		t.Fatalf("expected valid production config to pass, got: %v", err)
	}
}

func TestAuthenticateBearerRequest_RejectsQueryToken(t *testing.T) {
	req := httptest.NewRequest("POST", "/api/v1/resource/delete?token=abc.def.ghi", nil)
	if _, err := AuthenticateBearerRequest(req); err == nil {
		t.Fatalf("expected AuthenticateBearerRequest to reject query-string token")
	}
}
