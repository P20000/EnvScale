package k8s

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestIsInternalSecret(t *testing.T) {
	tests := []struct {
		name     string
		secret   *corev1.Secret
		expected bool
	}{
		{
			name: "ServiceAccountToken is internal",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Name: "my-token-abc"},
				Type:       corev1.SecretTypeServiceAccountToken,
			},
			expected: true,
		},
		{
			name: "Default token prefix is internal",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Name: "default-token-xyz789"},
				Type:       corev1.SecretTypeOpaque,
			},
			expected: true,
		},
		{
			name: "Helm release secret is internal",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Name: "sh.helm.release.v1.my-release"},
				Type:       "helm.sh/release.v1",
			},
			expected: true,
		},
		{
			name: "Application database credentials secret is NOT internal",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Name: "db-credentials"},
				Type:       corev1.SecretTypeOpaque,
			},
			expected: false,
		},
		{
			name: "TLS certificate secret is NOT internal",
			secret: &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Name: "ingress-tls"},
				Type:       corev1.SecretTypeTLS,
			},
			expected: false,
		},
		{
			name:     "Nil secret is internal (guard)",
			secret:   nil,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsInternalSecret(tt.secret)
			if got != tt.expected {
				t.Errorf("IsInternalSecret(%v) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}

func TestIsInternalConfigMap(t *testing.T) {
	tests := []struct {
		name     string
		cm       *corev1.ConfigMap
		expected bool
	}{
		{
			name: "kube-root-ca.crt is internal",
			cm: &corev1.ConfigMap{
				ObjectMeta: metav1.ObjectMeta{Name: "kube-root-ca.crt"},
			},
			expected: true,
		},
		{
			name: "kubeadm-config is internal",
			cm: &corev1.ConfigMap{
				ObjectMeta: metav1.ObjectMeta{Name: "kubeadm-config"},
			},
			expected: true,
		},
		{
			name: "Application config is NOT internal",
			cm: &corev1.ConfigMap{
				ObjectMeta: metav1.ObjectMeta{Name: "web-app-config"},
			},
			expected: false,
		},
		{
			name:     "Nil configmap is internal (guard)",
			cm:       nil,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsInternalConfigMap(tt.cm)
			if got != tt.expected {
				t.Errorf("IsInternalConfigMap(%v) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}

func TestExtractPodConfigReferences(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-server-pod",
			Namespace: "production",
		},
		Spec: corev1.PodSpec{
			Volumes: []corev1.Volume{
				{
					Name: "app-config-vol",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: "app-runtime-config"},
						},
					},
				},
				{
					Name: "db-secret-vol",
					VolumeSource: corev1.VolumeSource{
						Secret: &corev1.SecretVolumeSource{
							SecretName: "db-tls-certs",
						},
					},
				},
				{
					Name: "system-token-vol",
					VolumeSource: corev1.VolumeSource{
						Secret: &corev1.SecretVolumeSource{
							SecretName: "default-token-44kff",
						},
					},
				},
				{
					Name: "root-ca-vol",
					VolumeSource: corev1.VolumeSource{
						ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: "kube-root-ca.crt"},
						},
					},
				},
			},
			Containers: []corev1.Container{
				{
					Name: "api-container",
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "app-config-vol",
							MountPath: "/etc/config",
						},
						{
							Name:      "db-secret-vol",
							MountPath: "/etc/tls",
						},
					},
					Env: []corev1.EnvVar{
						{
							Name: "DATABASE_PASSWORD",
							ValueFrom: &corev1.EnvVarSource{
								SecretKeyRef: &corev1.SecretKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: "db-credentials"},
									Key:                  "password",
								},
							},
						},
						{
							Name: "MAX_CONNECTIONS",
							ValueFrom: &corev1.EnvVarSource{
								ConfigMapKeyRef: &corev1.ConfigMapKeySelector{
									LocalObjectReference: corev1.LocalObjectReference{Name: "db-pool-config"},
									Key:                  "max_conn",
								},
							},
						},
					},
					EnvFrom: []corev1.EnvFromSource{
						{
							ConfigMapRef: &corev1.ConfigMapEnvSource{
								LocalObjectReference: corev1.LocalObjectReference{Name: "feature-flags-bulk"},
							},
						},
						{
							SecretRef: &corev1.SecretEnvSource{
								LocalObjectReference: corev1.LocalObjectReference{Name: "oauth-tokens-bulk"},
							},
						},
					},
				},
			},
		},
	}

	cms, secs := ExtractPodConfigReferences(pod)

	// Validate ConfigMaps
	// Expected: app-runtime-config (volume), db-pool-config (env), feature-flags-bulk (envFrom)
	// Must filter out: kube-root-ca.crt
	if len(cms) != 3 {
		t.Fatalf("Expected 3 extracted ConfigMaps, got %d: %+v", len(cms), cms)
	}

	cmNames := make(map[string]string)
	for _, c := range cms {
		cmNames[c.Name] = c.Type
	}

	if cmNames["app-runtime-config"] != "volume" {
		t.Errorf("Expected app-runtime-config to be volume type, got %s", cmNames["app-runtime-config"])
	}
	if cmNames["db-pool-config"] != "env" {
		t.Errorf("Expected db-pool-config to be env type, got %s", cmNames["db-pool-config"])
	}
	if cmNames["feature-flags-bulk"] != "envFrom" {
		t.Errorf("Expected feature-flags-bulk to be envFrom type, got %s", cmNames["feature-flags-bulk"])
	}

	// Validate Secrets
	// Expected: db-tls-certs (volume), db-credentials (env), oauth-tokens-bulk (envFrom)
	// Must filter out: default-token-44kff
	if len(secs) != 3 {
		t.Fatalf("Expected 3 extracted Secrets, got %d: %+v", len(secs), secs)
	}

	secNames := make(map[string]string)
	for _, s := range secs {
		secNames[s.Name] = s.Type
	}

	if secNames["db-tls-certs"] != "volume" {
		t.Errorf("Expected db-tls-certs to be volume type, got %s", secNames["db-tls-certs"])
	}
	if secNames["db-credentials"] != "env" {
		t.Errorf("Expected db-credentials to be env type, got %s", secNames["db-credentials"])
	}
	if secNames["oauth-tokens-bulk"] != "envFrom" {
		t.Errorf("Expected oauth-tokens-bulk to be envFrom type, got %s", secNames["oauth-tokens-bulk"])
	}
}
