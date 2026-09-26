import type { Node, Edge } from "@xyflow/react";
import type { K8sPVCData } from "../../components/canvas/K8sPVC";
import type { K8sPodData } from "../../components/canvas/K8sPod";
import type {
  K8sPVData,
  K8sVolumeSnapshotData,
} from "../types/topologyTypes";


/**
 * Extracts all PVC claim names referenced by a Pod's volume configuration.
 * Inspects pvcClaims, volumes, and rawResource.spec.volumes.
 */
export function extractPvcClaimsFromPod(pod: unknown): string[] {
  if (!pod) return [];
  const p = pod as Record<string, unknown>;
  const podData = (p.data as Record<string, unknown>) || p;
  const raw = (podData.rawResource as Record<string, unknown>) || podData;
  const spec = (raw.spec || podData.spec || {}) as Record<string, unknown>;

  const claims = new Set<string>();

  // 1. Direct pvcClaims array if populated
  if (Array.isArray(podData.pvcClaims)) {
    podData.pvcClaims.forEach((c) => {
      if (typeof c === "string" && c) claims.add(c);
    });
  }

  // 2. Volumes array on pod data or spec
  const volumes = (podData.volumes || spec.volumes || raw.volumes) as unknown[];
  if (Array.isArray(volumes)) {
    volumes.forEach((v) => {
      if (!v || typeof v !== "object") return;
      const vol = v as Record<string, unknown>;
      const pvc = vol.persistentVolumeClaim as Record<string, unknown> | undefined;
      if (pvc?.claimName && typeof pvc.claimName === "string") {
        claims.add(pvc.claimName);
      }
    });
  }

  return Array.from(claims);
}

/**
 * Returns names of all Pods that mount a given PVC.
 */
export function getPodsMountingPVC(
  pods: unknown[],
  pvcName: string,
  namespace?: string
): string[] {
  if (!pods || !pvcName) return [];

  const matched = new Set<string>();

  pods.forEach((p) => {
    const podObj = p as Record<string, unknown>;
    const podData = ((podObj.data as Record<string, unknown>) || podObj) as K8sPodData;
    const podNs = String(podData.namespace || "default");

    if (namespace && podNs !== namespace) return;

    const claims = extractPvcClaimsFromPod(p);
    if (claims.includes(pvcName)) {
      matched.add(podData.name || String(podObj.id));
    }
  });

  return Array.from(matched).sort();
}

/**
 * Generates dynamic React Flow edges for Storage resources:
 * - Pod → PVC with label "mounts"
 * - PVC → PV with label "bound to" (only if PV node exists in topology)
 * - PV → StorageClass with label "uses"
 * - PVC → StorageClass with label "requests" (if unbound/pending or PV not in graph)
 * - PVC → VolumeSnapshot with label "snapshot"
 * - VolumeSnapshot → VolumeSnapshotContent with label "backed by"
 */
export function generateStorageEdges(nodes: Node[]): Edge[] {
  const edges: Edge[] = [];

  const pvcNodes = nodes.filter((n) => n.type === "k8sPVC");
  const podNodes = nodes.filter((n) => n.type === "k8sPod");
  const pvNodes = nodes.filter((n) => n.type === "k8sPV" || n.type === "k8sPersistentVolume");
  const scNodes = nodes.filter((n) => n.type === "k8sStorageClass");
  const snapshotNodes = nodes.filter((n) => n.type === "k8sVolumeSnapshot");
  const snapshotContentNodes = nodes.filter((n) => n.type === "k8sVolumeSnapshotContent");

  // 1. Pod → PVC edges and PVC → PV edges
  pvcNodes.forEach((pvcNode) => {
    const pvcData = pvcNode.data as K8sPVCData;
    const pvcName = pvcData.name || pvcNode.id.replace(/^pvc-/, "");
    const pvcNs = pvcData.namespace || "default";

    // Pod → PVC
    podNodes.forEach((podNode) => {
      const podData = podNode.data as K8sPodData;
      const podNs = podData.namespace || "default";
      if (podNs !== pvcNs) return;

      const claims = extractPvcClaimsFromPod(podNode);
      if (claims.includes(pvcName)) {
        edges.push({
          id: `e-sys-pvc-mount-${podNode.id}-${pvcNode.id}`,
          source: podNode.id,
          target: pvcNode.id,
          type: "k8sEdge",
          animated: true,
          label: "mounts",
          data: {
            label: "mounts",
            strokeColor: "#06b6d4", // Cyan 500 for storage mount
            healthStatus: "healthy",
          },
          style: { stroke: "#06b6d4", strokeWidth: 2 },
        });
      }
    });

    // PVC → PV (only when Bound and PV node exists in topology)
    const isBound = String(pvcData.status || pvcData.phase || "").toLowerCase() === "bound";
    const volumeName = pvcData.volumeName;

    if (isBound && volumeName) {
      const matchedPV = pvNodes.find(
        (pv) =>
          pv.id === volumeName ||
          pv.id === `pv-${volumeName}` ||
          (pv.data as Record<string, unknown>)?.name === volumeName
      );

      if (matchedPV) {
        edges.push({
          id: `e-sys-pvc-bound-${pvcNode.id}-${matchedPV.id}`,
          source: pvcNode.id,
          target: matchedPV.id,
          type: "k8sEdge",
          animated: false,
          label: "bound to",
          data: {
            label: "bound to",
            strokeColor: "#10b981", // Emerald 500 for bound PV
            healthStatus: "healthy",
          },
          style: { stroke: "#10b981", strokeWidth: 2 },
        });
      }
    }

    // PVC → StorageClass fallback (if no bound PV edge found)
    const hasBoundPvEdge = isBound && volumeName && pvNodes.some(
      (pv) =>
        pv.id === volumeName ||
        pv.id === `pv-${volumeName}` ||
        (pv.data as Record<string, unknown>)?.name === volumeName
    );
    const scName = pvcData.storageClassName || pvcData.storageClass;
    if (!hasBoundPvEdge && scName) {
      const matchedSC = scNodes.find(
        (sc) =>
          sc.id === scName ||
          sc.id === `sc-${scName}` ||
          (sc.data as Record<string, unknown>)?.name === scName
      );
      if (matchedSC) {
        edges.push({
          id: `e-sys-pvc-sc-${pvcNode.id}-${matchedSC.id}`,
          source: pvcNode.id,
          target: matchedSC.id,
          type: "k8sEdge",
          animated: false,
          label: "requests",
          data: {
            label: "requests",
            strokeColor: "#8b5cf6",
            healthStatus: "healthy",
          },
          style: { stroke: "#8b5cf6", strokeWidth: 2, strokeDasharray: "4 2" },
        });
      }
    }
  });

  // 2. PV → StorageClass edges
  pvNodes.forEach((pvNode) => {
    const pvData = pvNode.data as K8sPVData;
    const rawSpec = (pvData?.rawResource as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
    const scName = pvData?.storageClassName || (rawSpec?.storageClassName as string);
    if (!scName) return;

    const matchedSC = scNodes.find(
      (sc) =>
        sc.id === scName ||
        sc.id === `sc-${scName}` ||
        (sc.data as Record<string, unknown>)?.name === scName
    );

    if (matchedSC) {
      edges.push({
        id: `e-sys-pv-sc-${pvNode.id}-${matchedSC.id}`,
        source: pvNode.id,
        target: matchedSC.id,
        type: "k8sEdge",
        animated: false,
        label: "uses",
        data: {
          label: "uses",
          strokeColor: "#8b5cf6", // Violet 500
          healthStatus: "healthy",
        },
        style: { stroke: "#8b5cf6", strokeWidth: 2 },
      });
    }
  });

  // 3. PVC → VolumeSnapshot and VolumeSnapshot → VolumeSnapshotContent edges
  snapshotNodes.forEach((snapNode) => {
    const snapData = snapNode.data as K8sVolumeSnapshotData;
    const rawSnap = (snapData?.rawResource as Record<string, unknown>) || {};
    const rawSpec = (rawSnap.spec as Record<string, unknown>) || {};
    const rawStatus = (rawSnap.status as Record<string, unknown>) || {};

    const srcPvc =
      snapData?.sourcePVCName ||
      ((rawSpec.source as Record<string, unknown>)?.persistentVolumeClaimName as string);
    const snapNs = snapData?.namespace || "default";

    if (srcPvc) {
      const matchedPVC = pvcNodes.find((pvc) => {
        const pvcData = pvc.data as K8sPVCData;
        const pvcName = pvcData?.name || pvc.id.replace(/^pvc-/, "");
        const pvcNs = pvcData?.namespace || "default";
        return pvcName === srcPvc && pvcNs === snapNs;
      });

      if (matchedPVC) {
        edges.push({
          id: `e-sys-pvc-snap-${matchedPVC.id}-${snapNode.id}`,
          source: matchedPVC.id,
          target: snapNode.id,
          type: "k8sEdge",
          animated: false,
          label: "snapshot",
          data: {
            label: "snapshot",
            strokeColor: "#0ea5e9", // Sky 500 for snapshot
            healthStatus: "healthy",
          },
          style: { stroke: "#0ea5e9", strokeWidth: 2 },
        });
      }
    }

    const contentName =
      snapData?.snapshotContentName ||
      (rawStatus.boundVolumeSnapshotContentName as string);

    if (contentName) {
      const matchedContent = snapshotContentNodes.find(
        (c) =>
          c.id === contentName ||
          c.id === `vsc-${contentName}` ||
          (c.data as Record<string, unknown>)?.name === contentName
      );

      if (matchedContent) {
        edges.push({
          id: `e-sys-snap-content-${snapNode.id}-${matchedContent.id}`,
          source: snapNode.id,
          target: matchedContent.id,
          type: "k8sEdge",
          animated: false,
          label: "backed by",
          data: {
            label: "backed by",
            strokeColor: "#64748b", // Slate 500
            healthStatus: "healthy",
          },
          style: { stroke: "#64748b", strokeWidth: 2 },
        });
      }
    }
  });

  return edges;
}


/**
 * Auto-derives PVC nodes from Pod volume claims if they are not already in rawNodes.
 */
export function derivePVCsFromPods(pods: Node[], existingRawNodes: Node[]): Node[] {
  const existingPvcKeys = new Set<string>();
  existingRawNodes
    .filter((n) => n.type === "k8sPVC")
    .forEach((n) => {
      const d = n.data as K8sPVCData | undefined;
      const name = d?.name || n.id.replace(/^pvc-/, "");
      const ns = d?.namespace || "default";
      existingPvcKeys.add(`${ns}/${name}`);
    });

  const derivedNodes: Node[] = [];

  pods.forEach((podNode) => {
    const podData = podNode.data as K8sPodData;
    const ns = podData.namespace || "default";
    const claims = extractPvcClaimsFromPod(podNode);

    claims.forEach((claimName) => {
      const key = `${ns}/${claimName}`;
      if (!existingPvcKeys.has(key)) {
        existingPvcKeys.add(key);
        derivedNodes.push({
          id: `pvc-${claimName}`,
          type: "k8sPVC",
          position: { x: 450, y: 350 },
          data: {
            name: claimName,
            namespace: ns,
            status: "Bound",
            phase: "Bound",
            requestedCapacity: "Allocated",
            storageClassName: "standard",
            accessModes: ["ReadWriteOnce"],
            volumeMode: "Filesystem",
          } as K8sPVCData,
        });
      }
    });
  });

  return derivedNodes;
}
