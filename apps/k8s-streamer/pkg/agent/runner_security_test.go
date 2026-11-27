package agent

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestBuildAgentTLSConfig_StrictByDefaultAndSupportsExplicitCA(t *testing.T) {
	cfg, err := buildAgentTLSConfig("", "")
	if err != nil {
		t.Fatalf("expected default TLS config to succeed, got: %v", err)
	}
	if cfg.InsecureSkipVerify {
		t.Fatalf("SEC-C5 regression: InsecureSkipVerify must NEVER be true")
	}

	// Generate valid test CA PEM
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed generating key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "EnvScale Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("failed creating cert: %v", err)
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})

	caPath := filepath.Join(t.TempDir(), "ca.crt")
	if err := os.WriteFile(caPath, caPEM, 0o600); err != nil {
		t.Fatalf("failed writing test CA: %v", err)
	}

	cfgWithCA, err := buildAgentTLSConfig(caPath, "")
	if err != nil {
		t.Fatalf("expected explicit CA_CERT_PATH to succeed, got: %v", err)
	}
	if cfgWithCA.InsecureSkipVerify {
		t.Fatalf("SEC-C5 regression: InsecureSkipVerify must be false with explicit CA")
	}

	if _, err := buildAgentTLSConfig("", "not-a-valid-pem"); err == nil {
		t.Fatalf("expected invalid CA_CERT_PEM to fail closed")
	}
}

func TestAgentTLSHandshake_RejectsUntrustedAndAcceptsExplicitCA(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	gotAuth := ""
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		conn.Close()
	}))
	defer srv.Close()

	wsURL := "wss" + strings.TrimPrefix(srv.URL, "https") + "/ws/agent?clusterId=c-1"

	// Without explicit CA, dialing a self-signed TLS server MUST fail verification
	defaultTLS, err := buildAgentTLSConfig("", "")
	if err != nil {
		t.Fatalf("unexpected default TLS config error: %v", err)
	}
	dialerDefault := websocket.Dialer{TLSClientConfig: defaultTLS, HandshakeTimeout: 3 * time.Second}
	if _, _, dialErr := dialerDefault.Dial(wsURL, nil); dialErr == nil {
		t.Fatalf("SEC-C5 regression: agent dialed untrusted self-signed TLS server without explicit CA")
	}

	// With server's explicit CA PEM, TLS WebSocket handshake + Authorization header succeeds
	serverCertPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw})
	caTLS, err := buildAgentTLSConfig("", string(serverCertPEM))
	if err != nil {
		t.Fatalf("expected server CA PEM to load, got: %v", err)
	}
	dialerCA := websocket.Dialer{TLSClientConfig: caTLS, HandshakeTimeout: 3 * time.Second}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer agent-token-xyz")
	conn, _, err := dialerCA.Dial(wsURL, headers)
	if err != nil {
		t.Fatalf("expected WebSocket TLS handshake with explicit CA to succeed, got: %v", err)
	}
	conn.Close()
	if gotAuth != "Bearer agent-token-xyz" {
		t.Fatalf("SEC-H4: expected Authorization Bearer header on agent WS upgrade, got %q", gotAuth)
	}
}

