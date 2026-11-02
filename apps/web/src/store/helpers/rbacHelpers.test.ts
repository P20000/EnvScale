import { describe, it } from "node:test";
import assert from "node:assert";
import { resolvePodRBAC } from "./rbacHelpers";
import type {
  K8sRoleBindingData,
  K8sClusterRoleBindingData,
  K8sRoleData,
  K8sClusterRoleData,
} from "../types/topologyTypes";

describe("rbacHelpers.resolvePodRBAC", () => {
  it("resolves default ServiceAccount with standard restricted privileges when no bindings exist", () => {
    const rbac = resolvePodRBAC("default", "prod", {}, true);

    assert.strictEqual(rbac.serviceAccount, "default");
    assert.strictEqual(rbac.namespace, "prod");
    assert.strictEqual(rbac.privilegeLevel, "Restricted");
    assert.strictEqual(rbac.privilegeLabel, "Restricted Default");
    assert.strictEqual(rbac.automountToken, true);
    assert.strictEqual(rbac.bindings.length, 0);
    assert.strictEqual(rbac.allRules.length, 0);
  });

  it("resolves custom ServiceAccount with RoleBinding and Read-Only permissions", () => {
    const roleBindings: K8sRoleBindingData[] = [
      {
        name: "reader-binding",
        namespace: "prod",
        roleRef: { kind: "Role", name: "pod-reader", apiGroup: "rbac.authorization.k8s.io" },
        subjects: [{ kind: "ServiceAccount", name: "app-sa", namespace: "prod" }],
      },
    ];

    const roles: K8sRoleData[] = [
      {
        name: "pod-reader",
        namespace: "prod",
        rules: [
          { verbs: ["get", "list", "watch"], resources: ["pods"], apiGroups: [""] },
        ],
      },
    ];

    const rbac = resolvePodRBAC("app-sa", "prod", { roleBindings, roles });

    assert.strictEqual(rbac.serviceAccount, "app-sa");
    assert.strictEqual(rbac.privilegeLevel, "ReadOnly");
    assert.strictEqual(rbac.bindings.length, 1);
    assert.strictEqual(rbac.bindings[0].roleName, "pod-reader");
    assert.strictEqual(rbac.allRules.length, 1);
    assert.deepStrictEqual(rbac.allRules[0].verbs, ["get", "list", "watch"]);
  });

  it("detects Elevated Write privileges when role allows mutation verbs", () => {
    const roleBindings: K8sRoleBindingData[] = [
      {
        name: "deploy-writer-binding",
        namespace: "staging",
        roleRef: { kind: "Role", name: "deployer", apiGroup: "rbac.authorization.k8s.io" },
        subjects: [{ kind: "ServiceAccount", name: "ci-sa", namespace: "staging" }],
      },
    ];

    const roles: K8sRoleData[] = [
      {
        name: "deployer",
        namespace: "staging",
        rules: [
          { verbs: ["create", "update", "patch"], resources: ["deployments"], apiGroups: ["apps"] },
        ],
      },
    ];

    const rbac = resolvePodRBAC("ci-sa", "staging", { roleBindings, roles });

    assert.strictEqual(rbac.privilegeLevel, "Elevated");
    assert.strictEqual(rbac.privilegeLabel, "Elevated Write");
  });

  it("detects Cluster Admin access when bound to cluster-admin ClusterRole", () => {
    const clusterRoleBindings: K8sClusterRoleBindingData[] = [
      {
        name: "admin-binding",
        roleRef: { kind: "ClusterRole", name: "cluster-admin", apiGroup: "rbac.authorization.k8s.io" },
        subjects: [{ kind: "ServiceAccount", name: "admin-sa", namespace: "kube-system" }],
      },
    ];

    const clusterRoles: K8sClusterRoleData[] = [
      {
        name: "cluster-admin",
        rules: [{ verbs: ["*"], resources: ["*"], apiGroups: ["*"] }],
      },
    ];

    const rbac = resolvePodRBAC("admin-sa", "kube-system", {
      clusterRoleBindings,
      clusterRoles,
    });

    assert.strictEqual(rbac.isClusterAdmin, true);
    assert.strictEqual(rbac.privilegeLevel, "ClusterAdmin");
    assert.strictEqual(rbac.privilegeLabel, "Cluster Admin");
  });
});
