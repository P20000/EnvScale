import type {
  K8sServiceAccountData,
  K8sRoleBindingData,
  K8sClusterRoleBindingData,
  K8sRoleData,
  K8sClusterRoleData,
  RBACPolicyRuleInfo,
} from "../types/topologyTypes";

export type PrivilegeLevel = "ClusterAdmin" | "Elevated" | "ReadOnly" | "Restricted";

export interface ResolvedBindingInfo {
  bindingName: string;
  bindingType: "RoleBinding" | "ClusterRoleBinding";
  roleName: string;
  roleKind: "Role" | "ClusterRole";
  scope: string;
  rules: RBACPolicyRuleInfo[];
}

export interface ResolvedRBAC {
  serviceAccount: string;
  namespace: string;
  automountToken: boolean;
  privilegeLevel: PrivilegeLevel;
  privilegeLabel: string;
  bindings: ResolvedBindingInfo[];
  allRules: RBACPolicyRuleInfo[];
  summaryText: string;
  isClusterAdmin: boolean;
}

/**
 * Resolves a workload/pod's ServiceAccount into its active RoleBindings, ClusterRoleBindings,
 * and aggregated API permission policy rules.
 */
export function resolvePodRBAC(
  serviceAccountName: string | undefined,
  namespace: string | undefined,
  rbacStore: {
    serviceAccounts?: K8sServiceAccountData[];
    roleBindings?: K8sRoleBindingData[];
    clusterRoleBindings?: K8sClusterRoleBindingData[];
    roles?: K8sRoleData[];
    clusterRoles?: K8sClusterRoleData[];
  },
  automountServiceAccountToken?: boolean
): ResolvedRBAC {
  const sa = (serviceAccountName || "default").trim();
  const ns = (namespace || "default").trim();

  const roleBindings = rbacStore.roleBindings || [];
  const clusterRoleBindings = rbacStore.clusterRoleBindings || [];
  const roles = rbacStore.roles || [];
  const clusterRoles = rbacStore.clusterRoles || [];

  const matchedBindings: ResolvedBindingInfo[] = [];

  // 1. Check Namespace RoleBindings
  for (const rb of roleBindings) {
    if (rb.namespace !== ns) continue;
    const hasSubject = (rb.subjects || []).some(
      (s) =>
        s.kind === "ServiceAccount" &&
        s.name === sa &&
        (!s.namespace || s.namespace === ns)
    );
    if (!hasSubject) continue;

    let rules: RBACPolicyRuleInfo[] = [];
    if (rb.roleRef.kind === "Role") {
      const matchedRole = roles.find(
        (r) => r.name === rb.roleRef.name && r.namespace === ns
      );
      if (matchedRole) rules = matchedRole.rules || [];
    } else if (rb.roleRef.kind === "ClusterRole") {
      const matchedCR = clusterRoles.find((cr) => cr.name === rb.roleRef.name);
      if (matchedCR) rules = matchedCR.rules || [];
    }

    matchedBindings.push({
      bindingName: rb.name,
      bindingType: "RoleBinding",
      roleName: rb.roleRef.name,
      roleKind: rb.roleRef.kind as "Role" | "ClusterRole",
      scope: `Namespace (${ns})`,
      rules,
    });
  }

  // 2. Check Cluster-wide ClusterRoleBindings
  for (const crb of clusterRoleBindings) {
    const hasSubject = (crb.subjects || []).some(
      (s) =>
        s.kind === "ServiceAccount" &&
        s.name === sa &&
        (!s.namespace || s.namespace === ns)
    );
    if (!hasSubject) continue;

    const matchedCR = clusterRoles.find((cr) => cr.name === crb.roleRef.name);
    matchedBindings.push({
      bindingName: crb.name,
      bindingType: "ClusterRoleBinding",
      roleName: crb.roleRef.name,
      roleKind: "ClusterRole",
      scope: "Cluster-Wide",
      rules: matchedCR?.rules || [],
    });
  }

  // Aggregate all rules
  const allRules: RBACPolicyRuleInfo[] = [];
  for (const b of matchedBindings) {
    allRules.push(...b.rules);
  }

  // Classify privilege level
  let isClusterAdmin = false;
  let hasWrite = false;
  let hasRead = false;

  for (const b of matchedBindings) {
    if (
      b.bindingType === "ClusterRoleBinding" &&
      (b.roleName === "cluster-admin" || b.roleName === "admin")
    ) {
      isClusterAdmin = true;
    }
  }

  for (const rule of allRules) {
    const verbs = (rule.verbs || []).map((v) => v.toLowerCase());
    const resources = (rule.resources || []).map((r) => r.toLowerCase());

    if (
      verbs.includes("*") &&
      (resources.includes("*") || resources.length === 0)
    ) {
      isClusterAdmin = true;
    }

    if (
      verbs.some((v) =>
        ["create", "update", "patch", "delete", "deletecollection", "*"].includes(v)
      )
    ) {
      hasWrite = true;
    }

    if (verbs.some((v) => ["get", "list", "watch", "*"].includes(v))) {
      hasRead = true;
    }
  }

  let privilegeLevel: PrivilegeLevel = "Restricted";
  let privilegeLabel = "Restricted Default";
  let summaryText =
    "Runs with standard default ServiceAccount privileges. No elevated cluster authorization or custom role bindings detected.";

  if (isClusterAdmin) {
    privilegeLevel = "ClusterAdmin";
    privilegeLabel = "Cluster Admin";
    summaryText =
      "CRITICAL PRIVILEGE: Unrestricted full cluster-admin access to all API resources, namespaces, and secrets across the Kubernetes control plane.";
  } else if (hasWrite) {
    privilegeLevel = "Elevated";
    privilegeLabel = "Elevated Write";
    summaryText =
      "Has write/mutation authorization (create/update/delete) on target Kubernetes resources in the cluster.";
  } else if (hasRead) {
    privilegeLevel = "ReadOnly";
    privilegeLabel = "Read-Only Access";
    summaryText =
      "Authorized for inspection and telemetry reading (get/list/watch) without mutation privileges.";
  }

  return {
    serviceAccount: sa,
    namespace: ns,
    automountToken: automountServiceAccountToken !== false,
    privilegeLevel,
    privilegeLabel,
    bindings: matchedBindings,
    allRules,
    summaryText,
    isClusterAdmin,
  };
}
