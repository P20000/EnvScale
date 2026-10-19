import {
  MdDns as NodeIcon,
  MdCheckCircle as CheckCircle,
  MdWarning as AlertTriangle,
  MdSecurity as DaemonIcon,
} from "react-icons/md";
import type { K8sDaemonSetData } from "../../../store/types/topologyTypes";
import { useTopologyStore } from "../../../store/useTopologyStore";
import type { K8sNodeData } from "../../canvas/K8sNode";

interface DaemonSetOverviewSectionProps {
  data: K8sDaemonSetData;
}

export function DaemonSetOverviewSection({ data }: DaemonSetOverviewSectionProps) {
  const nodes = useTopologyStore((s) => s.nodes);

  const workerNodes = nodes
    .filter((n) => n.type === "k8sWorker" || n.id.startsWith("node-"))
    .map((n) => n.data as K8sNodeData);

  const desired = data.desiredNumberScheduled ?? workerNodes.length ?? 1;
  const ready = data.numberReady ?? 0;
  const current = data.currentNumberScheduled ?? desired;
  const isHealthy = ready >= desired && desired > 0;

  return (
    <div className="space-y-3.5">
      {/* DaemonSet Health & Scheduling Spec */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <DaemonIcon className="h-4 w-4 text-purple-400" />
            DaemonSet Status
          </h4>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded border ${
              isHealthy
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {isHealthy ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {ready}/{desired} Nodes Scheduled
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="block text-neutral-400 text-[10px]">Desired Scheduled</span>
            <span className="font-mono text-neutral-200 font-semibold">{desired} Nodes</span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Current Running</span>
            <span className="font-mono text-neutral-200 font-semibold">{current} Pods</span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Ready Pods</span>
            <span className={`font-mono font-semibold ${ready >= desired ? "text-emerald-400" : "text-amber-400"}`}>
              {ready}
            </span>
          </div>
          <div>
            <span className="block text-neutral-400 text-[10px]">Updated Scheduled</span>
            <span className="font-mono text-neutral-200 font-semibold">
              {typeof data.updatedNumberScheduled === "number" ? data.updatedNumberScheduled : ready}
            </span>
          </div>
        </div>
      </div>

      {/* Per-Node Placement & Distribution Matrix */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
            <NodeIcon className="h-4 w-4 text-blue-400" />
            Host Node Distribution ({workerNodes.length})
          </h4>
          <span className="text-[10px] text-neutral-400 font-mono">1 Pod Per Host</span>
        </div>

        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
          {workerNodes.length === 0 ? (
            <div className="p-3 text-xs text-neutral-500 italic text-center rounded-lg border border-neutral-800/60 bg-neutral-950">
              Host nodes registered automatically via cluster streamer.
            </div>
          ) : (
            workerNodes.map((node) => {
              const nodeHealthy = isHealthy && (node.status === "Ready" || node.status === "Running");

              return (
                <div
                  key={node.name}
                  className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs font-mono space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-200 font-semibold flex items-center gap-1.5">
                      <NodeIcon className="h-3.5 w-3.5 text-neutral-400" />
                      {node.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded border ${
                        nodeHealthy
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                      }`}
                    >
                      {nodeHealthy ? "Resident Agent Ready" : "Agent Scheduled"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-neutral-400 pt-0.5">
                    <span>Host IP: {node.ip || "10.0.0.1"}</span>
                    <span>Node Load: {node.cpuPct ?? 25}% CPU</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
