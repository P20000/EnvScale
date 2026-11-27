package k8s

import (
	"fmt"
	"net/url"

	"k8s.io/client-go/tools/clientcmd"
)

// ValidateKubeconfigSecurity enforces strict security boundaries on uploaded kubeconfigs
// before client-go instantiation (eliminates SEC-C5 TLS bypass and SEC-C6 exec RCE / local file read).
func ValidateKubeconfigSecurity(kubeconfigBytes []byte) error {
	if len(kubeconfigBytes) == 0 {
		return fmt.Errorf("unsafe kubeconfig rejected: payload cannot be empty")
	}

	rawCfg, err := clientcmd.Load(kubeconfigBytes)
	if err != nil {
		return fmt.Errorf("invalid kubeconfig YAML: %w", err)
	}

	if len(rawCfg.Clusters) == 0 {
		return fmt.Errorf("unsafe kubeconfig rejected: no clusters defined")
	}
	if len(rawCfg.AuthInfos) == 0 {
		return fmt.Errorf("unsafe kubeconfig rejected: no user credentials defined")
	}

	for name, cluster := range rawCfg.Clusters {
		if cluster == nil {
			return fmt.Errorf("unsafe kubeconfig rejected: cluster %q is empty", name)
		}
		if cluster.Server == "" {
			return fmt.Errorf("unsafe kubeconfig rejected: cluster %q missing server URL", name)
		}
		parsed, err := url.Parse(cluster.Server)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
			return fmt.Errorf("unsafe kubeconfig rejected: cluster %q has invalid server URL", name)
		}
		if cluster.CertificateAuthority != "" {
			return fmt.Errorf("unsafe kubeconfig rejected: cluster %q uses local certificate-authority file path; use certificate-authority-data", name)
		}
		if cluster.InsecureSkipTLSVerify {
			return fmt.Errorf("unsafe kubeconfig rejected: cluster %q sets insecure-skip-tls-verify; supply valid certificate-authority-data", name)
		}
	}

	for name, authInfo := range rawCfg.AuthInfos {
		if authInfo == nil {
			continue
		}
		if authInfo.Exec != nil {
			return fmt.Errorf("unsafe kubeconfig rejected: user %q contains arbitrary exec plugin", name)
		}
		if authInfo.AuthProvider != nil {
			return fmt.Errorf("unsafe kubeconfig rejected: user %q contains external auth-provider plugin", name)
		}
		if authInfo.ClientCertificate != "" || authInfo.ClientKey != "" || authInfo.TokenFile != "" {
			return fmt.Errorf("unsafe kubeconfig rejected: user %q references local credential file paths; embed inline *-data or token", name)
		}
	}

	if rawCfg.CurrentContext == "" {
		return fmt.Errorf("unsafe kubeconfig rejected: missing current-context")
	}
	activeCtx, ctxExists := rawCfg.Contexts[rawCfg.CurrentContext]
	if !ctxExists || activeCtx == nil || activeCtx.Cluster == "" {
		return fmt.Errorf("unsafe kubeconfig rejected: current-context %q is invalid", rawCfg.CurrentContext)
	}
	if _, clusterExists := rawCfg.Clusters[activeCtx.Cluster]; !clusterExists {
		return fmt.Errorf("unsafe kubeconfig rejected: current-context cluster %q not found", activeCtx.Cluster)
	}

	return nil
}

