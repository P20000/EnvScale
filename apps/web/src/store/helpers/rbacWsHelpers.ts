import type { TopologyState } from "../useTopologyStore";
import type {
  K8sServiceAccountData,
  K8sRoleBindingData,
  K8sClusterRoleBindingData,
  K8sRoleData,
  K8sClusterRoleData,
} from "../types/topologyTypes";

export function handleRBACWsEvent(
  state: TopologyState,
  set: (partial: Partial<TopologyState>) => void,
  eventType: string,
  payloadData: Record<string, unknown>
) {
  const name = String(payloadData.name || "");
  const namespace = String(payloadData.namespace || "default");
  if (!name) return;

  if (eventType === "EVENT_SERVICEACCOUNT_MUTATED") {
    const list = state.serviceAccounts || [];
    const idx = list.findIndex((s) => s.name === name && s.namespace === namespace);
    const updated = [...list];
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], ...payloadData } as K8sServiceAccountData;
    } else {
      updated.push(payloadData as K8sServiceAccountData);
    }
    set({ serviceAccounts: updated });
  } else if (eventType === "EVENT_SERVICEACCOUNT_DELETED") {
    set({
      serviceAccounts: (state.serviceAccounts || []).filter(
        (s) => !(s.name === name && s.namespace === namespace)
      ),
    });
  } else if (eventType === "EVENT_ROLEBINDING_MUTATED") {
    const list = state.roleBindings || [];
    const idx = list.findIndex((r) => r.name === name && r.namespace === namespace);
    const updated = [...list];
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], ...payloadData } as K8sRoleBindingData;
    } else {
      updated.push(payloadData as K8sRoleBindingData);
    }
    set({ roleBindings: updated });
  } else if (eventType === "EVENT_ROLEBINDING_DELETED") {
    set({
      roleBindings: (state.roleBindings || []).filter(
        (r) => !(r.name === name && r.namespace === namespace)
      ),
    });
  } else if (eventType === "EVENT_CLUSTERROLEBINDING_MUTATED") {
    const list = state.clusterRoleBindings || [];
    const idx = list.findIndex((c) => c.name === name);
    const updated = [...list];
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], ...payloadData } as K8sClusterRoleBindingData;
    } else {
      updated.push(payloadData as K8sClusterRoleBindingData);
    }
    set({ clusterRoleBindings: updated });
  } else if (eventType === "EVENT_CLUSTERROLEBINDING_DELETED") {
    set({
      clusterRoleBindings: (state.clusterRoleBindings || []).filter((c) => c.name !== name),
    });
  } else if (eventType === "EVENT_ROLE_MUTATED") {
    const list = state.roles || [];
    const idx = list.findIndex((r) => r.name === name && r.namespace === namespace);
    const updated = [...list];
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], ...payloadData } as K8sRoleData;
    } else {
      updated.push(payloadData as K8sRoleData);
    }
    set({ roles: updated });
  } else if (eventType === "EVENT_ROLE_DELETED") {
    set({
      roles: (state.roles || []).filter(
        (r) => !(r.name === name && r.namespace === namespace)
      ),
    });
  } else if (eventType === "EVENT_CLUSTERROLE_MUTATED") {
    const list = state.clusterRoles || [];
    const idx = list.findIndex((c) => c.name === name);
    const updated = [...list];
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], ...payloadData } as K8sClusterRoleData;
    } else {
      updated.push(payloadData as K8sClusterRoleData);
    }
    set({ clusterRoles: updated });
  } else if (eventType === "EVENT_CLUSTERROLE_DELETED") {
    set({
      clusterRoles: (state.clusterRoles || []).filter((c) => c.name !== name),
    });
  }
}
