import { KubeConfig } from "@kubernetes/client-node";

export class KubeconfigSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KubeconfigSecurityError";
  }
}

const DISALLOWED_YAML_KEY_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /(?:^|[\s,{])["']?exec["']?\s*:/m, reason: "arbitrary user.exec plugins are prohibited" },
  { regex: /(?:^|[\s,{])["']?auth-provider["']?\s*:/m, reason: "external auth-provider plugins are prohibited" },
  { regex: /(?:^|[\s,{])["']?certificate-authority["']?\s*:/m, reason: "local certificate-authority file paths are prohibited; use certificate-authority-data" },
  { regex: /(?:^|[\s,{])["']?client-certificate["']?\s*:/m, reason: "local client-certificate file paths are prohibited; use client-certificate-data" },
  { regex: /(?:^|[\s,{])["']?client-key["']?\s*:/m, reason: "local client-key file paths are prohibited; use client-key-data" },
  { regex: /(?:^|[\s,{])["']?tokenFile["']?\s*:/mi, reason: "local tokenFile paths are prohibited; use inline bearer token" },
  { regex: /(?:^|[\s,{])["']?insecure-skip-tls-verify["']?\s*:\s*["']?true\b/mi, reason: "insecure-skip-tls-verify is prohibited; supply certificate-authority-data" },
];

/**
 * Validates uploaded kubeconfig YAML/JSON before any Kubernetes client instantiation.
 * Eliminates SEC-C5 (TLS bypass) and SEC-C6 (exec RCE & local file read).
 */
export function validateKubeconfigSecurity(rawKubeconfig: string): { apiServerUrl: string } {
  if (!rawKubeconfig || !rawKubeconfig.trim()) {
    throw new KubeconfigSecurityError("Kubeconfig payload cannot be empty");
  }

  for (const { regex, reason } of DISALLOWED_YAML_KEY_PATTERNS) {
    if (regex.test(rawKubeconfig)) {
      throw new KubeconfigSecurityError(`Rejected unsafe kubeconfig: ${reason}`);
    }
  }

  const kubeConfig = new KubeConfig();
  try {
    kubeConfig.loadFromString(rawKubeconfig);
  } catch {
    throw new KubeconfigSecurityError("Invalid kubeconfig: YAML syntax parsing failed");
  }

  const allClusters = kubeConfig.getClusters();
  if (!allClusters || allClusters.length === 0) {
    throw new KubeconfigSecurityError("Kubeconfig error: no clusters defined");
  }

  const allUsers = kubeConfig.getUsers();
  if (!allUsers || allUsers.length === 0) {
    throw new KubeconfigSecurityError("Kubeconfig error: no user credentials defined");
  }

  for (const c of allClusters) {
    if (!c.server) {
      throw new KubeconfigSecurityError("Kubeconfig error: cluster entry missing server URL");
    }
    let clusterUrl: URL;
    try {
      clusterUrl = new URL(c.server);
    } catch {
      throw new KubeconfigSecurityError("Kubeconfig error: invalid cluster server URL");
    }
    if ((clusterUrl.protocol !== "https:" && clusterUrl.protocol !== "http:") || !clusterUrl.host) {
      throw new KubeconfigSecurityError("Kubeconfig error: cluster server URL must use https:// or http:// with a valid host");
    }
    if (c.caFile) {
      throw new KubeconfigSecurityError("Rejected unsafe kubeconfig: local certificate-authority file paths are prohibited");
    }
    if (c.skipTLSVerify === true) {
      throw new KubeconfigSecurityError("Rejected unsafe kubeconfig: insecure-skip-tls-verify is prohibited");
    }
  }

  for (const u of allUsers) {
    const userRecord = u as unknown as Record<string, unknown>;
    if (userRecord.exec) {
      throw new KubeconfigSecurityError("Rejected unsafe kubeconfig: arbitrary user.exec plugins are prohibited");
    }
    if (u.authProvider) {
      throw new KubeconfigSecurityError("Rejected unsafe kubeconfig: external auth-provider plugins are prohibited");
    }
    if (u.certFile || u.keyFile || userRecord.tokenFile) {
      throw new KubeconfigSecurityError("Rejected unsafe kubeconfig: local credential file paths are prohibited");
    }
  }

  const activeCluster = kubeConfig.getCurrentCluster();
  if (!activeCluster?.server) {
    throw new KubeconfigSecurityError("Kubeconfig error: missing active context cluster server URL");
  }

  return { apiServerUrl: activeCluster.server };
}

