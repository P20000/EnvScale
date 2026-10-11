import type { K8sConfigMapData, K8sSecretData, PodConfigReference, PodSecretReference } from "../types/topologyTypes";
import type { K8sPodData } from "../../components/canvas/K8sPod";

export interface MissingConfigAudit {
  kind: "ConfigMap" | "Secret";
  name: string;
  podName: string;
  workloadName?: string;
  namespace: string;
  refType: "volume" | "env" | "envFrom";
  key?: string;
  mountPath?: string;
}

/**
 * Reducer helper handling real-time WebSocket events for ConfigMaps.
 */
export function handleConfigMapWsEvent(
  current: K8sConfigMapData[],
  payload: Record<string, unknown>,
  isDelete: boolean
): K8sConfigMapData[] {
  const name = String(payload.name || payload.id || "");
  const namespace = String(payload.namespace || "default");
  if (!name) return current;

  if (isDelete) {
    return current.filter((c) => !(c.name === name && c.namespace === namespace));
  }

  const existingIdx = current.findIndex((c) => c.name === name && c.namespace === namespace);
  const updatedItem: K8sConfigMapData = {
    name,
    namespace,
    keys: Array.isArray(payload.keys) ? (payload.keys as string[]) : [],
    binaryKeys: Array.isArray(payload.binaryKeys) ? (payload.binaryKeys as string[]) : [],
    dataCount: Number(payload.dataCount ?? (Array.isArray(payload.keys) ? payload.keys.length : 0)),
    immutable: Boolean(payload.immutable),
    labels: (payload.labels as Record<string, string>) || {},
    createdAt: payload.createdAt ? String(payload.createdAt) : undefined,
    age: payload.age ? String(payload.age) : undefined,
  };

  if (existingIdx >= 0) {
    const updated = [...current];
    updated[existingIdx] = { ...updated[existingIdx], ...updatedItem };
    return updated;
  }

  return [...current, updatedItem];
}

/**
 * Reducer helper handling real-time WebSocket events for sanitized Secrets.
 */
export function handleSecretWsEvent(
  current: K8sSecretData[],
  payload: Record<string, unknown>,
  isDelete: boolean
): K8sSecretData[] {
  const name = String(payload.name || payload.id || "");
  const namespace = String(payload.namespace || "default");
  if (!name) return current;

  if (isDelete) {
    return current.filter((s) => !(s.name === name && s.namespace === namespace));
  }

  const existingIdx = current.findIndex((s) => s.name === name && s.namespace === namespace);
  const updatedItem: K8sSecretData = {
    name,
    namespace,
    type: String(payload.type || "Opaque"),
    keys: Array.isArray(payload.keys) ? (payload.keys as string[]) : [],
    dataCount: Number(payload.dataCount ?? (Array.isArray(payload.keys) ? payload.keys.length : 0)),
    immutable: Boolean(payload.immutable),
    labels: (payload.labels as Record<string, string>) || {},
    createdAt: payload.createdAt ? String(payload.createdAt) : undefined,
    age: payload.age ? String(payload.age) : undefined,
  };

  if (existingIdx >= 0) {
    const updated = [...current];
    updated[existingIdx] = { ...updated[existingIdx], ...updatedItem };
    return updated;
  }

  return [...current, updatedItem];
}

/**
 * Production Diagnostic Audit:
 * Scans all pods to detect any referenced ConfigMap or Secret that is missing from the cluster.
 * Missing references trigger the infamous Kubernetes CreateContainerConfigError.
 */
export function findMissingConfigReferences(
  pods: K8sPodData[],
  configMaps: K8sConfigMapData[],
  secrets: K8sSecretData[],
  targetNamespace?: string
): MissingConfigAudit[] {
  const audits: MissingConfigAudit[] = [];

  const cmSet = new Set(
    configMaps
      .filter((c) => !targetNamespace || c.namespace === targetNamespace)
      .map((c) => `${c.namespace}/${c.name}`)
  );

  const secSet = new Set(
    secrets
      .filter((s) => !targetNamespace || s.namespace === targetNamespace)
      .map((s) => `${s.namespace}/${s.name}`)
  );

  const filteredPods = targetNamespace ? pods.filter((p) => p.namespace === targetNamespace) : pods;

  for (const pod of filteredPods) {
    const ns = pod.namespace || "default";
    const workloadName = pod.ownerName || pod.name;

    // Audit ConfigMaps
    if (pod.configMaps && pod.configMaps.length > 0) {
      for (const cmRef of pod.configMaps) {
        if (cmRef.optional) continue;
        const key = `${ns}/${cmRef.name}`;
        if (!cmSet.has(key)) {
          audits.push({
            kind: "ConfigMap",
            name: cmRef.name,
            podName: pod.name,
            workloadName,
            namespace: ns,
            refType: cmRef.type,
            key: cmRef.key,
            mountPath: cmRef.mountPath,
          });
        }
      }
    }

    // Audit Secrets
    if (pod.secrets && pod.secrets.length > 0) {
      for (const secRef of pod.secrets) {
        if (secRef.optional) continue;
        const key = `${ns}/${secRef.name}`;
        if (!secSet.has(key)) {
          audits.push({
            kind: "Secret",
            name: secRef.name,
            podName: pod.name,
            workloadName,
            namespace: ns,
            refType: secRef.type,
            key: secRef.key,
            mountPath: secRef.mountPath,
          });
        }
      }
    }
  }

  return audits;
}

/**
 * Aggregates all unique ConfigMaps and Secrets referenced across a list of Pods.
 */
export function aggregatePodConfigs(pods: K8sPodData[]): {
  configs: PodConfigReference[];
  secrets: PodSecretReference[];
} {
  const cmMap = new Map<string, PodConfigReference>();
  const secMap = new Map<string, PodSecretReference>();

  for (const p of pods) {
    if (p.configMaps) {
      for (const c of p.configMaps) {
        if (!cmMap.has(c.name)) {
          cmMap.set(c.name, c);
        }
      }
    }
    if (p.secrets) {
      for (const s of p.secrets) {
        if (!secMap.has(s.name)) {
          secMap.set(s.name, s);
        }
      }
    }
  }

  return {
    configs: Array.from(cmMap.values()),
    secrets: Array.from(secMap.values()),
  };
}
