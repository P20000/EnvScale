import {
  MdPublic as IngressIcon,
  MdCheckCircle as CheckCircle2,
  MdTerminal as Terminal,
} from "react-icons/md";
import type { SelectedTarget } from "../InspectorDrawer";
import type { K8sPodData } from "../../canvas/K8sPod";

import { useResourceLogs } from "../../../hooks/useResourceLogs";
import { LogRow } from "../LogRow";

interface OverviewTabProps {
  target: NonNullable<SelectedTarget>;
  nowMs: number;
  isEmbeddedLogOpen: boolean;
  setIsEmbeddedLogOpen: (val: boolean) => void;
  onOpenLogTerminal?: (podName: string, namespace?: string) => void;
}

export function OverviewTab({
  target,
  nowMs,
  isEmbeddedLogOpen,
  setIsEmbeddedLogOpen,
  onOpenLogTerminal,
}: OverviewTabProps) {
  const targetRecord = target.data as unknown as Record<string, unknown>;

  const { logs } = useResourceLogs({
    name: target.data?.name || null,
    kind: target.type === "pod" ? "Pod" : target.type === "service" ? "Service" : target.type === "ingress" ? "Ingress" : "Workload",
    namespace: String(targetRecord.namespace || "testing-todo"),
    enabled: isEmbeddedLogOpen,
  });

  const getNodeAssignment = () => {
    if (target.type === "node") return target.data.name;
    if (targetRecord.nodeName) return String(targetRecord.nodeName);
    if (targetRecord.node) return String(targetRecord.node);
    return null;
  };

  const getPodIp = () => {
    if (targetRecord.podIp) return String(targetRecord.podIp);
    if (targetRecord.ip) return String(targetRecord.ip);
    return null;
  };

  const getDynamicUptime = () => {
    const createdRaw = targetRecord.createdAt || (target.data as K8sPodData)?.createdAt;
    if (!createdRaw) return null;
    const createdTime = new Date(String(createdRaw)).getTime();
    if (isNaN(createdTime)) return null;
    const diffMs = Math.max(0, nowMs - createdTime);
    const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const h = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="space-y-4">
      {target.type === "ingress" ? (
        <>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
              <IngressIcon className="h-4 w-4 text-violet-400" />
              Ingress Spec & Controller
            </h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="block text-neutral-400 text-[10px]">Resource Name</span>
                <span className="font-mono text-neutral-200 font-medium truncate block">
                  {target.data.name}
                </span>
              </div>
              <div>
                <span className="block text-neutral-400 text-[10px]">Namespace</span>
                <span className="font-mono text-neutral-200 font-medium">
                  {target.data.namespace || "default"}
                </span>
              </div>
              <div>
                <span className="block text-neutral-400 text-[10px]">Ingress Class</span>
                <span className="font-mono text-violet-300 font-medium">
                  {target.data.ingressClassName || "nginx"}
                </span>
              </div>
              <div>
                <span className="block text-neutral-400 text-[10px]">TLS Termination</span>
                <span className="font-mono text-emerald-400 font-medium">
                  {target.data.tls && target.data.tls.length > 0
                    ? `${target.data.tls.length} Binding(s)`
                    : "Disabled (HTTP)"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              HTTP Routing Rules ({target.data.rules?.length || 0})
            </h4>
            {!target.data.rules || target.data.rules.length === 0 ? (
              <p className="text-xs text-neutral-500 italic">No routing rules configured.</p>
            ) : (
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {target.data.rules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs font-mono space-y-1"
                  >
                    <div className="flex justify-between items-center text-neutral-300">
                      <span className="text-neutral-500 text-[10px]">Host:</span>
                      <span className="text-violet-300 font-semibold">{rule.host || "* (Default Host)"}</span>
                    </div>
                    <div className="flex justify-between items-center text-neutral-400">
                      <span className="text-neutral-500 text-[10px]">Path:</span>
                      <span className="text-neutral-200 bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                        {rule.path || "/"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-neutral-400 pt-0.5">
                      <span className="text-neutral-500 text-[10px]">Target Service:</span>
                      <span className="text-emerald-400">
                        {rule.serviceName}:{rule.servicePort}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
            <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              Load Balancer Status
            </h4>
            <div className="space-y-1 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">External Endpoint:</span>
                <span className="text-neutral-200">
                  {target.data.loadBalancerIps && target.data.loadBalancerIps.length > 0
                    ? target.data.loadBalancerIps.join(", ")
                    : "127.0.0.1 (Ingress Controller IP)"}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              Workload Details
            </h4>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="block text-neutral-400 text-[10px]">Resource Name</span>
                <span className="font-mono text-neutral-200 font-medium truncate block">
                  {target.data.name}
                </span>
              </div>
              <div>
                <span className="block text-neutral-400 text-[10px]">Namespace</span>
                <span className="font-mono text-neutral-200 font-medium">
                  {targetRecord.namespace ? String(targetRecord.namespace) : "kube-system"}
                </span>
              </div>
              <div>
                <span className="block text-neutral-400 text-[10px]">Status</span>
                {(() => {
                  const statusStr = String(targetRecord.status || targetRecord.phase || "Running").trim();
                  const isErr =
                    statusStr.includes("Error") ||
                    statusStr.includes("OOM") ||
                    statusStr.includes("Crash") ||
                    statusStr.includes("Failed");
                  const isWarn = statusStr.includes("Pending") || statusStr.includes("Creating");
                  const statusColor = isErr
                    ? "text-rose-400"
                    : isWarn
                    ? "text-amber-400"
                    : "text-emerald-400";
                  return (
                    <span className={`inline-flex items-center gap-1 font-semibold ${statusColor}`}>
                      <CheckCircle2 className="h-3 w-3" />
                      {statusStr}
                    </span>
                  );
                })()}
              </div>
              <div>
                <span className="block text-neutral-400 text-[10px]">Restarts</span>
                <span className="font-mono text-neutral-200">
                  {String(targetRecord.restarts ?? targetRecord.restartCount ?? (target.data as K8sPodData)?.restarts ?? 0)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2">
            <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
              Placement & IP
            </h4>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Node Assignment:</span>
                {getNodeAssignment() ? (
                  <span className="text-neutral-200">{getNodeAssignment()}</span>
                ) : (
                  <span className="font-mono text-xs text-neutral-500 italic">unassigned</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Pod IP Address:</span>
                {getPodIp() ? (
                  <span className="text-neutral-200">{getPodIp()}</span>
                ) : (
                  <span className="font-mono text-xs text-neutral-500 italic">unassigned</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-400">Uptime:</span>
                {getDynamicUptime() ? (
                  <span className="text-neutral-200">{getDynamicUptime()}</span>
                ) : (
                  <span className="font-mono text-xs text-neutral-500 italic">unassigned</span>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {target.type === "pod" && (
        isEmbeddedLogOpen ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-blue-400" />
                Live Log Terminal
              </h4>
              <div className="flex items-center gap-1.5">
                {onOpenLogTerminal && (
                  <button
                    onClick={() =>
                      onOpenLogTerminal(
                        target.data.name,
                        targetRecord.namespace ? String(targetRecord.namespace) : "default"
                      )
                    }
                    className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-mono text-blue-300 hover:bg-blue-500/30 transition-colors border border-blue-500/30 cursor-pointer"
                  >
                    Expand Terminal ↗
                  </button>
                )}
                <button
                  onClick={() => setIsEmbeddedLogOpen(false)}
                  className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-700 transition-colors"
                >
                  Minimize
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-black/80 border border-neutral-800 p-1 font-mono text-[11px] h-32 overflow-y-auto space-y-0.5">
              {logs.length === 0 ? (
                <div className="text-neutral-500 italic p-2 text-center">Connecting live stdout/stderr stream...</div>
              ) : (
                logs.slice(-15).map((l, index) => (
                  <LogRow key={l.id || index} log={l} index={index} showSource={false} />
                ))
              )}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsEmbeddedLogOpen(true)}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900/40 p-2.5 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 transition-colors flex items-center justify-center gap-2 font-mono"
          >
            <Terminal className="h-4 w-4 text-blue-400" />
            Show Live Embedded Log Stream
          </button>
        )
      )}
    </div>
  );
}
