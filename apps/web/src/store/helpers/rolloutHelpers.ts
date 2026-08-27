export interface K8sReplicaSetData {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  ownerUid?: string;
  ownerName?: string;
  ownerKind?: string;
  labels?: Record<string, string>;
  revision?: string;
  images?: string[];
  createdAt?: string;
}

export interface K8sDeploymentData {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  selector?: Record<string, string>;
  labels?: Record<string, string>;
  createdAt?: string;
}

export interface RevisionItem {
  name: string;
  hash: string;
  revision: string;
  replicas: number;
  readyReplicas: number;
  desiredReplicas: number;
  status: "Active (Current)" | "Scaling Up" | "Scaling Down" | "Scaled Down (Old)";
  images: string[];
  createdAt?: string;
  isCurrent: boolean;
}

export interface RolloutInfo {
  isRollingUpdate: boolean;
  isStandaloneReplicaSet?: boolean;
  oldRevision?: {
    name: string;
    hash: string;
    revision: string;
    replicas: number;
    readyReplicas: number;
  };
  newRevision?: {
    name: string;
    hash: string;
    revision: string;
    replicas: number;
    readyReplicas: number;
  };
  allRevisions: RevisionItem[];
}

export const getTemplateHash = (rsName: string, labels?: Record<string, string>): string => {
  if (labels?.["pod-template-hash"]) {
    return labels["pod-template-hash"];
  }
  const parts = rsName.split("-");
  if (parts.length > 1) {
    const suffix = parts[parts.length - 1];
    if (suffix && suffix.length >= 8 && /^[a-f0-9]+$/i.test(suffix)) {
      return suffix;
    }
  }
  return rsName.slice(-8);
};

export const calculateRolloutInfo = (
  workloadName: string,
  namespace: string,
  deployments: K8sDeploymentData[] = [],
  replicaSets: K8sReplicaSetData[] = []
): RolloutInfo | null => {
  if (!workloadName) return null;

  // Check if workloadName itself is a standalone ReplicaSet
  const standaloneRs = replicaSets.find(
    (rs) =>
      rs.name === workloadName &&
      (rs.namespace || "default") === (namespace || "default") &&
      rs.ownerKind !== "Deployment" &&
      !rs.ownerName
  );

  if (standaloneRs) {
    const hash = getTemplateHash(standaloneRs.name, standaloneRs.labels);
    const item: RevisionItem = {
      name: standaloneRs.name,
      hash,
      revision: standaloneRs.revision || "1",
      replicas: standaloneRs.replicas ?? 0,
      readyReplicas: standaloneRs.readyReplicas ?? 0,
      desiredReplicas: standaloneRs.replicas ?? 0,
      status: "Active (Current)",
      images: standaloneRs.images || [],
      createdAt: standaloneRs.createdAt,
      isCurrent: true,
    };
    return {
      isRollingUpdate: false,
      isStandaloneReplicaSet: true,
      allRevisions: [item],
    };
  }

  // Find parent Deployment
  const parentDep = deployments.find(
    (dep) =>
      dep.name === workloadName && (dep.namespace || "default") === (namespace || "default")
  );

  // Find all ReplicaSets belonging to this Deployment/Workload
  const matchedRS = replicaSets.filter((rs) => {
    if ((rs.namespace || "default") !== (namespace || "default")) return false;
    if (rs.ownerName === workloadName && (rs.ownerKind === "Deployment" || !rs.ownerKind)) {
      return true;
    }
    if (rs.name.startsWith(`${workloadName}-`)) {
      return true;
    }
    if (parentDep?.selector && rs.labels) {
      const isMatch = Object.keys(parentDep.selector).every(
        (k) => rs.labels?.[k] === parentDep.selector?.[k]
      );
      if (isMatch) return true;
    }
    return false;
  });

  if (matchedRS.length === 0) return null;

  // Sort ReplicaSets: primary by revision (descending), secondary by createdAt (descending)
  const sortedRS = [...matchedRS].sort((a, b) => {
    const revA = parseInt(a.revision || "0", 10);
    const revB = parseInt(b.revision || "0", 10);
    if (revA !== revB && !isNaN(revA) && !isNaN(revB)) {
      return revB - revA;
    }
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeB - timeA;
  });

  const activeRSList = sortedRS.filter((rs) => (rs.replicas ?? 0) > 0 || (rs.readyReplicas ?? 0) > 0);
  const isRollingUpdate = activeRSList.length > 1;

  const targetNewRS = sortedRS[0]; // Newest revision
  const allRevisions: RevisionItem[] = sortedRS.map((rs, index) => {
    const isNewest = index === 0;
    let status: RevisionItem["status"] = "Scaled Down (Old)";
    if (isNewest) {
      status = isRollingUpdate ? "Scaling Up" : "Active (Current)";
    } else if ((rs.replicas ?? 0) > 0) {
      status = "Scaling Down";
    }

    return {
      name: rs.name,
      hash: getTemplateHash(rs.name, rs.labels),
      revision: rs.revision || String(sortedRS.length - index),
      replicas: rs.replicas ?? 0,
      readyReplicas: rs.readyReplicas ?? 0,
      desiredReplicas: rs.replicas ?? 0,
      status,
      images: rs.images || [],
      createdAt: rs.createdAt,
      isCurrent: isNewest,
    };
  });

  let oldRevision;
  let newRevision;

  if (isRollingUpdate) {
    const oldRS = sortedRS.find((rs) => rs.name !== targetNewRS.name && (rs.replicas ?? 0) > 0);
    newRevision = {
      name: targetNewRS.name,
      hash: getTemplateHash(targetNewRS.name, targetNewRS.labels),
      revision: targetNewRS.revision || "2",
      replicas: targetNewRS.replicas ?? 0,
      readyReplicas: targetNewRS.readyReplicas ?? 0,
    };
    if (oldRS) {
      oldRevision = {
        name: oldRS.name,
        hash: getTemplateHash(oldRS.name, oldRS.labels),
        revision: oldRS.revision || "1",
        replicas: oldRS.replicas ?? 0,
        readyReplicas: oldRS.readyReplicas ?? 0,
      };
    }
  }

  return {
    isRollingUpdate,
    isStandaloneReplicaSet: false,
    oldRevision,
    newRevision,
    allRevisions,
  };
};
