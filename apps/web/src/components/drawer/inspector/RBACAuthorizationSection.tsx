import { useMemo } from "react";
import { MdSecurity, MdVpnKey, MdShield, MdVerifiedUser } from "react-icons/md";
import { useTopologyStore } from "../../../store/useTopologyStore";
import { resolvePodRBAC } from "../../../store/helpers/rbacHelpers";

interface RBACAuthorizationSectionProps {
  serviceAccountName?: string;
  namespace?: string;
  automountToken?: boolean;
}

export function RBACAuthorizationSection({
  serviceAccountName,
  namespace,
  automountToken,
}: RBACAuthorizationSectionProps) {
  const serviceAccounts = useTopologyStore((s) => s.serviceAccounts);
  const roleBindings = useTopologyStore((s) => s.roleBindings);
  const clusterRoleBindings = useTopologyStore((s) => s.clusterRoleBindings);
  const roles = useTopologyStore((s) => s.roles);
  const clusterRoles = useTopologyStore((s) => s.clusterRoles);

  const rbac = useMemo(() => {
    return resolvePodRBAC(
      serviceAccountName,
      namespace,
      {
        serviceAccounts,
        roleBindings,
        clusterRoleBindings,
        roles,
        clusterRoles,
      },
      automountToken
    );
  }, [
    serviceAccountName,
    namespace,
    serviceAccounts,
    roleBindings,
    clusterRoleBindings,
    roles,
    clusterRoles,
    automountToken,
  ]);

  const levelBadgeClass =
    rbac.privilegeLevel === "ClusterAdmin"
      ? "bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_10px_rgba(244,63,94,0.3)] animate-pulse"
      : rbac.privilegeLevel === "Elevated"
      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
      : rbac.privilegeLevel === "ReadOnly"
      ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
      : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5 space-y-3 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
          <MdSecurity className="h-4 w-4 text-violet-400" />
          <span className="uppercase tracking-wider">In-Cluster RBAC & Permissions</span>
        </div>
        <span
          className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0 ${levelBadgeClass}`}
        >
          {rbac.privilegeLabel}
        </span>
      </div>

      {/* Identity Summary Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/60">
        <div>
          <span className="block text-[10px] text-neutral-400">ServiceAccount</span>
          <span className="font-semibold text-violet-300 flex items-center gap-1 truncate" title={rbac.serviceAccount}>
            <MdVpnKey className="h-3 w-3 text-violet-400 shrink-0" />
            <span className="truncate">{rbac.serviceAccount}</span>
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-neutral-400">Namespace Scope</span>
          <span className="font-medium text-neutral-200 truncate block">
            {rbac.namespace}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-neutral-400">Token Automount</span>
          <span className="text-[11px] font-medium text-neutral-300 flex items-center gap-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                rbac.automountToken ? "bg-emerald-400" : "bg-neutral-500"
              }`}
            />
            {rbac.automountToken ? "Projected Token" : "Disabled (No Token)"}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-neutral-400">Active Bindings</span>
          <span className="text-[11px] font-medium text-neutral-300">
            {rbac.bindings.length > 0 ? `${rbac.bindings.length} Role Binding(s)` : "None (Default Restrict)"}
          </span>
        </div>
      </div>

      {/* Active RoleBindings Breakdown */}
      {rbac.bindings.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Bound Roles & Access Scopes
          </span>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
            {rbac.bindings.map((b) => (
              <div
                key={b.bindingName}
                className="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-950/40 border border-neutral-800 text-[11px]"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <MdShield className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-neutral-200 font-medium truncate block">
                      {b.roleName}
                    </span>
                    <span className="text-[9px] text-neutral-400 block truncate">
                      via {b.bindingType}: <code className="text-neutral-300">{b.bindingName}</code>
                    </span>
                  </div>
                </div>
                <span className="text-[8.5px] px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-800 text-neutral-300 shrink-0 font-medium">
                  {b.scope}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* API Permissions Matrix */}
      {rbac.allRules.length > 0 ? (
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider block">
            Effective Kubernetes API Grants ({rbac.allRules.length} Rules)
          </span>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 overflow-hidden max-h-40 overflow-y-auto text-[10.5px]">
            <table className="w-full text-left">
              <thead className="bg-neutral-800/40 text-[9px] uppercase text-neutral-400 border-b border-neutral-800">
                <tr>
                  <th className="py-1 px-2">Resources</th>
                  <th className="py-1 px-2">API Group</th>
                  <th className="py-1 px-2">Allowed Verbs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {rbac.allRules.map((rule, idx) => (
                  <tr key={idx} className="hover:bg-neutral-800/20">
                    <td className="py-1.5 px-2 text-neutral-200 font-medium">
                      {(rule.resources || ["*"]).join(", ")}
                    </td>
                    <td className="py-1.5 px-2 text-neutral-400 text-[9.5px]">
                      {(rule.apiGroups && rule.apiGroups.length > 0
                        ? rule.apiGroups.map((g) => (g === "" ? '"" (core)' : g)).join(", ")
                        : '"" (core)')}
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex flex-wrap gap-1">
                        {(rule.verbs || []).map((v) => {
                          const vLower = v.toLowerCase();
                          const chipClass =
                            vLower === "*"
                              ? "bg-purple-500/20 text-purple-300 border-purple-500/30 font-bold"
                              : ["create", "update", "patch", "delete", "deletecollection"].includes(vLower)
                              ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
                              : "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
                          return (
                            <span
                              key={v}
                              className={`text-[8.5px] px-1 py-0.2 rounded border font-mono ${chipClass}`}
                            >
                              {v}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-2.5 rounded-lg bg-neutral-950/40 border border-neutral-800 text-[11px] text-neutral-400 space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-neutral-300">
            <MdVerifiedUser className="h-3.5 w-3.5 text-emerald-400" />
            Standard Kubernetes Isolation
          </div>
          <p className="text-[10px] leading-relaxed text-neutral-400">
            No custom RBAC role bindings granted to <code className="text-violet-300">{rbac.serviceAccount}</code>. In Kubernetes, default accounts cannot read or mutate cluster resources without explicit RoleBindings.
          </p>
        </div>
      )}

      {/* Security Summary Callout */}
      <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/80 p-2 text-[10.5px] text-neutral-300 leading-snug">
        <span className="font-semibold text-neutral-200">Security Posture: </span>
        <span className="text-neutral-400">{rbac.summaryText}</span>
      </div>
    </div>
  );
}
