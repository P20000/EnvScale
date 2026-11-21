import { MdShield as ShieldIcon, MdSync as RolloutIcon } from "react-icons/md";
import type { K8sNetworkPolicyData } from "../../../store/types/topologyTypes";
import type { K8sDeploymentData } from "../../../store/helpers/rolloutHelpers";

interface NetworkPolicyRolloutSectionProps {
  deployment?: K8sDeploymentData | null;
  networkPolicies?: K8sNetworkPolicyData[];
}

export function NetworkPolicyRolloutSection({
  deployment,
  networkPolicies = [],
}: NetworkPolicyRolloutSectionProps) {
  const hasPolicies = networkPolicies.length > 0;
  const hasDeployment = Boolean(deployment);

  if (!hasPolicies && !hasDeployment) return null;

  const maxSurge = deployment?.maxSurge ?? "25%";
  const maxUnavailable = deployment?.maxUnavailable ?? "0";
  const minReadySeconds = deployment?.minReadySeconds ?? 0;

  // Aggregate ingress rules from matched network policies
  const allIngressRules = Array.from(
    new Set(networkPolicies.flatMap((np) => np.ingressRules || []))
  );

  return (
    <div className="rounded-xl border border-violet-500/20 bg-neutral-900/50 p-3.5 space-y-3 font-mono">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider flex items-center gap-1.5 font-sans">
          <ShieldIcon className="h-4 w-4 text-emerald-400" />
          Network Policy & Rollout Strategy
        </h4>
        {hasPolicies && (
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
            Strict Ingress Enforced
          </span>
        )}
      </div>

      {/* Rollout Strategy Badge Row */}
      {hasDeployment && (
        <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 flex items-center gap-1">
              <RolloutIcon className="text-amber-400" />
              Strategy:
              <span className="text-neutral-200 font-semibold">RollingUpdate</span>
            </span>
            {minReadySeconds > 0 && (
              <span className="text-[10px] text-zinc-400">
                MinReady: {minReadySeconds}s
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-neutral-800">
            <div>
              <span className="text-neutral-500 text-[10px] block">Max Surge</span>
              <span className="font-semibold text-emerald-300">{maxSurge}</span>
            </div>
            <div>
              <span className="text-neutral-500 text-[10px] block">Max Unavailable</span>
              <span className="font-semibold text-amber-300">{maxUnavailable}</span>
            </div>
          </div>
        </div>
      )}

      {/* Ingress Whitelist / Network Policy Card */}
      {hasPolicies ? (
        <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">
              Ingress Whitelist ({networkPolicies.length} {networkPolicies.length === 1 ? "Policy" : "Policies"})
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {allIngressRules.length > 0 ? (
              allIngressRules.map((rule, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[11px] flex items-center gap-1"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {rule.startsWith("from:pod(") ? rule.replace("from:pod(", "").replace(")", "") : rule}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-neutral-400 italic">
                Isolated Pod — Ingress strictly restricted to namespace peers
              </span>
            )}
          </div>

          <div className="text-[10px] text-neutral-500 pt-1 border-t border-neutral-800/80">
            Active: {networkPolicies.map((np) => np.name).join(", ")}
          </div>
        </div>
      ) : (
        <div className="p-2 rounded bg-neutral-950/60 border border-neutral-800 text-[10px] text-neutral-500 italic">
          No NetworkPolicy attached (Default open ingress)
        </div>
      )}
    </div>
  );
}
