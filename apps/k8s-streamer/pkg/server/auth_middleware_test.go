package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestRequireAuth_AnonymousAllowed(t *testing.T) {
	os.Setenv("ALLOW_ANONYMOUS_WS", "true")
	defer os.Unsetenv("ALLOW_ANONYMOUS_WS")

	called := false
	handler := RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/chaos/inject", nil)
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}
	if !called {
		t.Fatalf("expected handler to be invoked")
	}
}

func TestRequireAuth_StrictFailsWithoutToken(t *testing.T) {
	os.Setenv("ALLOW_ANONYMOUS_WS", "false")
	defer os.Unsetenv("ALLOW_ANONYMOUS_WS")

	called := false
	handler := RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/chaos/inject", nil)
	rec := httptest.NewRecorder()

	handler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", rec.Code)
	}
	if called {
		t.Fatalf("expected handler NOT to be invoked")
	}
}
