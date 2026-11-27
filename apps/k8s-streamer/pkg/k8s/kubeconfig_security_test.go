package k8s

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/EnvScale/k8s-streamer/pkg/websocket"
)

func TestValidateKubeconfigSecurity_RejectsExecAndLocalFilesAndInsecure(t *testing.T) {
	tests := []struct {
		name       string
		kubeconfig string
	}{
		{
			name: "SEC-C6 arbitrary exec command",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: eks
  cluster:
    server: https://eks.example.com
    certificate-authority-data: dGVzdA==
users:
- name: eks-user
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: /bin/sh
      args: ["-c", "id"]
contexts:
- name: ctx
  context:
    cluster: eks
    user: eks-user
current-context: ctx
`,
		},
		{
			name: "SEC-C6 local certificate-authority file path",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: local
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority: /etc/passwd
users:
- name: u
  user:
    token: tok
contexts:
- name: ctx
  context:
    cluster: local
    user: u
current-context: ctx
`,
		},
		{
			name: "SEC-C6 local client-key and tokenFile paths",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: local
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority-data: dGVzdA==
users:
- name: u
  user:
    client-certificate: /tmp/cert.pem
    client-key: /tmp/key.pem
    tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
contexts:
- name: ctx
  context:
    cluster: local
    user: u
current-context: ctx
`,
		},
		{
			name: "SEC-C5 insecure-skip-tls-verify true",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: insecure-cluster
  cluster:
    server: https://127.0.0.1:6443
    insecure-skip-tls-verify: true
users:
- name: u
  user:
    token: tok
contexts:
- name: ctx
  context:
    cluster: insecure-cluster
    user: u
current-context: ctx
`,
		},
		{
			name: "SEC-C6 JSON exec plugin",
			kubeconfig: `{"apiVersion":"v1","kind":"Config","clusters":[{"name":"eks","cluster":{"server":"https://eks.example.com","certificate-authority-data":"dGVzdA=="}}],"users":[{"name":"u","user":{"exec":{"apiVersion":"client.authentication.k8s.io/v1beta1","command":"sh"}}}],"contexts":[{"name":"ctx","context":{"cluster":"eks","user":"u"}}],"current-context":"ctx"}`,
		},
		{
			name: "SEC-C6 flow YAML exec and auth-provider",
			kubeconfig: "apiVersion: v1\nkind: Config\nclusters: [{name: gke, cluster: {server: https://gke.example.com, certificate-authority-data: dGVzdA==}}]\nusers: [{name: u, user: {auth-provider: {name: gcp}}}]\ncontexts: [{name: ctx, context: {cluster: gke, user: u}}]\ncurrent-context: ctx\n",
		},
		{
			name: "SEC-C6 JSON tokenFile and insecure-skip-tls-verify",
			kubeconfig: `{"apiVersion":"v1","kind":"Config","clusters":[{"name":"c","cluster":{"server":"https://127.0.0.1:6443","insecure-skip-tls-verify":true}}],"users":[{"name":"u","user":{"tokenFile":"/etc/passwd"}}],"contexts":[{"name":"ctx","context":{"cluster":"c","user":"u"}}],"current-context":"ctx"}`,
		},
		{
			name: "empty users rejected",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: safe
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority-data: dGVzdA==
users: []
contexts:
- name: ctx
  context:
    cluster: safe
current-context: ctx
`,
		},
		{
			name: "missing current-context rejected",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: safe
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority-data: dGVzdA==
users:
- name: u
  user:
    token: tok
`,
		},
		{
			name: "invalid server URL rejected",
			kubeconfig: `
apiVersion: v1
kind: Config
clusters:
- name: bad
  cluster:
    server: file:///etc/passwd
users:
- name: u
  user:
    token: tok
contexts:
- name: ctx
  context:
    cluster: bad
    user: u
current-context: ctx
`,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateKubeconfigSecurity([]byte(tc.kubeconfig)); err == nil {
				t.Fatalf("expected ValidateKubeconfigSecurity to reject %s, got nil", tc.name)
			}
		})
	}
}

func TestValidateKubeconfigSecurity_AcceptsSafeInlineKubeconfig(t *testing.T) {
	safe := `
apiVersion: v1
kind: Config
clusters:
- name: safe
  cluster:
    server: https://127.0.0.1:6443
    certificate-authority-data: dGVzdA==
users:
- name: u
  user:
    token: test-token
contexts:
- name: ctx
  context:
    cluster: safe
    user: u
current-context: ctx
`
	if err := ValidateKubeconfigSecurity([]byte(safe)); err != nil {
		t.Fatalf("expected safe inline kubeconfig to pass, got: %v", err)
	}
}

func TestNewInformerManager_DoesNotSilentlyFallbackToInsecureTLS(t *testing.T) {
	// Generate a self-signed TLS server NOT trusted by the kubeconfig CA
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed generating key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("failed creating cert: %v", err)
	}
	_ = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"gitVersion":"v1.30.0"}`))
	}))
	defer srv.Close()

	// Kubeconfig omits matching CA so x509 verification fails; NewInformerManager MUST fail rather than retrying with Insecure=true
	kc := `
apiVersion: v1
kind: Config
clusters:
- name: selfsigned
  cluster:
    server: ` + srv.URL + `
users:
- name: u
  user:
    token: tok
contexts:
- name: ctx
  context:
    cluster: selfsigned
    user: u
current-context: ctx
`
	_, mgrErr := NewInformerManager([]byte(kc), websocket.NewHub(), "selfsigned-cluster")
	if mgrErr == nil {
		t.Fatalf("SEC-C5 regression: NewInformerManager succeeded against untrusted self-signed TLS server")
	}
	if !strings.Contains(mgrErr.Error(), "TLS") && !strings.Contains(mgrErr.Error(), "x509") && !strings.Contains(mgrErr.Error(), "certificate") {
		t.Fatalf("expected TLS verification error, got: %v", mgrErr)
	}
}

