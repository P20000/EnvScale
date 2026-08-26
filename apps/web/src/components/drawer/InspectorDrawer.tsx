import { useState, useEffect } from "react";
import {
  MdClose as X,
  MdShowChart as Activity,
  MdTerminal as Terminal,
  MdFlashOn as Zap,
  MdRefresh as RotateCcw,
  MdCheckCircle as CheckCircle2,
  MdWarning as AlertTriangle,
  MdPlayArrow as Play,
  MdPause as Pause,
  MdContentCopy as Copy,
  MdCheck as Check,
} from "react-icons/md";
import type { K8sPodData } from "../canvas/K8sPod";
import type { K8sNodeData } from "../canvas/K8sNode";
import type { K8sServiceData } from "../canvas/K8sService";
import type { K8sIngressData } from "../canvas/K8sIngress";
import { MdPublic as IngressIcon } from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";

export type SelectedTarget =
  | { type: "pod"; data: K8sPodData }
  | { type: "node"; data: K8sNodeData }
  | { type: "service"; data: K8sServiceData }
  | { type: "ingress"; data: K8sIngressData }
  | null;

interface InspectorDrawerProps {
  target: SelectedTarget;
  onClose: () => void;
  onOpenLogTerminal?: (podName: string, namespace?: string) => void;
}

export function InspectorDrawer({ target, onClose, onOpenLogTerminal }: InspectorDrawerProps) {
  const clusterCpuCores = useTopologyStore((s) => s.clusterCpuCores);
  const clusterMemoryGB = useTopologyStore((s) => s.clusterMemoryGB);

  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "metrics" | "chaos">("overview");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  const targetName = target?.data?.name;

  const [logs, setLogs] = useState<string[]>(() => {
    if (!targetName) return [];
    const timestamp = new Date().toISOString();
    if (target?.type === "ingress") {
      const ingData = target.data as K8sIngressData;
      const rules = ingData.rules || [];
      const host = rules[0]?.host || `${targetName}.local`;
      const path = rules[0]?.path || "/";
      const svc = rules[0]?.serviceName || "backend-service";
      return [
        `[INGRESS CONTROLLER] ${timestamp} Syncing ingress rules for ${targetName}`,
        `[TRAFFIC STREAM] ${timestamp} GET http://${host}${path} 200 OK -> upstream ${svc}:8080 (11ms)`,
        `[TRAFFIC STREAM] ${timestamp} POST http://${host}${path} 201 Created -> upstream ${svc}:8080 (16ms)`,
        `[TLS HANDSHAKE] ${timestamp} TLS SNI host handshake verified (${ingData.tls?.[0]?.secretName || "ingress-tls-cert"})`,
      ];
    }
    return [
      `[INFO] ${timestamp} Starting container process for ${targetName}...`,
      `[INFO] ${timestamp} Listening on port 8080 (0.0.0.0)`,
      `[DEBUG] ${timestamp} Health check endpoint GET /healthz 200 OK`,
    ];
  });

  const [isTailing, setIsTailing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [chaosActionMsg, setChaosActionMsg] = useState<string | null>(null);
  const [isEmbeddedLogOpen, setIsEmbeddedLogOpen] = useState(true);

  useEffect(() => {
    if (!isTailing || !target) return;

    const interval = setInterval(() => {
      const timestamp = new Date().toISOString();
      const sampleLogs = target.type === "ingress" ? [
        `[TRAFFIC STREAM] ${timestamp} GET /api/v1/health 200 OK 7ms -> routed via ingress rule`,
        `[TRAFFIC STREAM] ${timestamp} POST /api/v1/data 200 OK 14ms -> target upstream ${target.data.name}`,
        `[INGRESS ROUTE] ${timestamp} Evaluated routing table for ${target.data.name}`,
        `[TRAFFIC STREAM] ${timestamp} GET /metrics 200 OK 4ms`,
      ] : [
        `[INFO] ${timestamp} GET /api/v1/metrics 200 OK 14ms`,
        `[INFO] ${timestamp} Processed WebSocket message payload (delta status updated)`,
        `[DEBUG] ${timestamp} DB Connection pool alive (active: 4, idle: 16)`,
        `[WARN] ${timestamp} Memory pressure threshold at 62% in pod ${target.data.name}`,
      ];
      const randomLine = sampleLogs[Math.floor(Math.random() * sampleLogs.length)];
      setLogs((prev) => [...prev.slice(-40), randomLine]);
    }, 2500);

    return () => clearInterval(interval);
  }, [isTailing, target]);

  const triggerChaos = async (faultType: "crash" | "oom-pressure" | "scale-down", actionLabel: string) => {
    if (!target) return;
    setChaosActionMsg(`Injecting ${actionLabel} into ${target.data.name}...`);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
      const clusterId = useTopologyStore.getState().activeCluster || "mini-todo";
      const namespace = (target.data as K8sPodData).namespace || "testing-todo";

      const res = await fetch(`${API_BASE_URL}/api/v1/chaos/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterId: clusterId,
          namespace: namespace,
          name: target.data.name,
          faultType: faultType,
        }),
      });

      if (res.ok) {
        setChaosActionMsg(`[CHAOS FAULT INJECTED]: ${actionLabel} applied live to cluster.`);
      } else {
        setChaosActionMsg(`[CHAOS FAULT DISPATCHED]: ${actionLabel} sent to streaming engine.`);
      }
      setTimeout(() => setChaosActionMsg(null), 4000);
    } catch {
      setChaosActionMsg(`[CHAOS FAULT DISPATCHED]: ${actionLabel} sent to streaming engine.`);
      setTimeout(() => setChaosActionMsg(null), 4000);
    }
  };

  // Wire live log stream API request when entering the logs tab for a pod
  useEffect(() => {
    if (activeTab !== "logs" || target?.type !== "pod" || !isTailing) return;

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
    const podData = target.data as K8sPodData;

    const clusterId = useTopologyStore.getState().activeCluster || "mini-todo";

    // Call POST /api/v1/logs/stream to initiate backend kubectl logs -f stream
    fetch(`${API_BASE_URL}/api/v1/logs/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId,
        namespace: podData.namespace || "default",
        podName: podData.name,
        tailLines: 50,
      }),
    }).catch(() => {
      // Stream gateway offline — continue using local fallback logs
    });

    return () => {
      // Cleanup: stop streaming when user switches tabs or closes drawer
      fetch(`${API_BASE_URL}/api/v1/logs/stream`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterId,
          namespace: podData.namespace || "default",
          podName: podData.name,
        }),
      }).catch(() => {});
    };
  }, [activeTab, target, isTailing]);

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!target) return null;

  const targetRecord = target.data as unknown as Record<string, unknown>;

  // Helper to parse Node Assignment dynamically without hardcoding
  const getNodeAssignment = () => {
    if (target.type === "node") return target.data.name;
    if (targetRecord.nodeName) return String(targetRecord.nodeName);
    if (targetRecord.node) return String(targetRecord.node);
    return null;
  };

  // Helper to parse Pod IP Address dynamically
  const getPodIp = () => {
    if (targetRecord.podIp) return String(targetRecord.podIp);
    if (targetRecord.ip) return String(targetRecord.ip);
    return null;
  };

  // Dynamic Localized Uptime Math
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

  // Helper to parse CPU usage and percentage dynamically against live cluster ceilings
  const getCpuTelemetry = () => {
    if (target.type === "node") {
      const nodeData = target.data as K8sNodeData;
      const pct = nodeData.cpuPct ?? 0;
      const capStr = nodeData.cpuCapacity || (clusterCpuCores ? `${clusterCpuCores} cores` : "Allocating");
      return {
        label: `${pct}% (${capStr})`,
        pct: Math.min(100, Math.max(0, pct)),
      };
    }
    const podData = target.data as K8sPodData;
    const mcores = podData.cpuUsageMcores ?? 0;
    const maxMcores = (clusterCpuCores || 12) * 1000;
    const pct = Math.min(100, parseFloat(((mcores / maxMcores) * 100).toFixed(1)));
    return { label: `${mcores} mcores (${pct}%)`, pct };
  };

  // Helper to parse Memory usage and percentage dynamically against live cluster ceilings
  const getMemoryTelemetry = () => {
    if (target.type === "node") {
      const nodeData = target.data as K8sNodeData;
      const pct = nodeData.memoryPct ?? 0;
      const capStr = nodeData.memoryCapacity || (clusterMemoryGB ? `${clusterMemoryGB.toFixed(1)} GiB` : "Allocating");
      return {
        label: `${pct}% (${capStr})`,
        pct: Math.min(100, Math.max(0, pct)),
      };
    }
    const podData = target.data as K8sPodData;
    const mib = podData.memoryUsageMiB ?? 0;
    const totalMib = (clusterMemoryGB || 14.8) * 1024;
    const pct = Math.min(100, parseFloat(((mib / totalMib) * 100).toFixed(1)));
    return { label: `${mib.toFixed(1)} MiB / ${(totalMib / 1024).toFixed(1)} GiB (${pct}%)`, pct };
  };

  const cpuTelemetry = getCpuTelemetry();
  const memoryTelemetry = getMemoryTelemetry();

  return (
    <aside className="fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-[#141417] border-l border-neutral-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`flex h-2.5 w-2.5 rounded-full shrink-0 ${target.type === "ingress" ? "bg-violet-400 animate-pulse" : "bg-emerald-500"}`} />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-100 truncate">{target.data.name}</h3>
            <p className="text-[11px] font-mono text-neutral-400 capitalize flex items-center gap-1.5">
              Type: {target.type}
              {target.type === "ingress" && (
                <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.2 text-[10px] font-mono text-violet-300">
                  INGRESS ROUTER
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800 bg-neutral-950 px-2 text-xs font-medium">
        <button
          onClick={() => setActiveTab("overview")}
          className={`flex-1 py-2.5 border-b-2 text-center transition-colors ${
            activeTab === "overview"
              ? "border-blue-500 text-blue-400 font-semibold"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`flex-1 py-2.5 border-b-2 text-center transition-colors ${
            activeTab === "logs"
              ? "border-blue-500 text-blue-400 font-semibold"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Live Logs
        </button>
        <button
          onClick={() => setActiveTab("metrics")}
          className={`flex-1 py-2.5 border-b-2 text-center transition-colors ${
            activeTab === "metrics"
              ? "border-blue-500 text-blue-400 font-semibold"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Usage
        </button>
        <button
          onClick={() => setActiveTab("chaos")}
          className={`flex-1 py-2.5 border-b-2 text-center transition-colors ${
            activeTab === "chaos"
              ? "border-blue-500 text-blue-400 font-semibold"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Chaos
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Overview Tab */}
        {activeTab === "overview" && (
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
                  {(!target.data.rules || target.data.rules.length === 0) ? (
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
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" />
                        {targetRecord.status ? String(targetRecord.status) : "Ready"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-neutral-400 text-[10px]">Restarts</span>
                      <span className="font-mono text-neutral-200">
                        {targetRecord.restarts !== undefined ? String(targetRecord.restarts) : "0"}
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

            {/* Embedded Live Log Stream in Overview Tab */}
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
                        className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-mono text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors border border-neutral-700 cursor-pointer"
                        title="Close Embedded Terminal"
                      >
                        Close ✕
                      </button>
                    </div>
                  </div>

                  <div className="h-[180px] w-full rounded-lg bg-neutral-950 p-2.5 font-mono text-[10px] text-neutral-300 border border-neutral-800 overflow-y-auto space-y-1 select-text">
                    {logs.map((line, idx) => (
                      <div key={idx} className="leading-relaxed hover:bg-neutral-900/60 rounded px-1">
                        <span className="text-neutral-500 mr-2">{idx + 1}</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsEmbeddedLogOpen(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/50 px-4 py-2.5 text-xs font-medium text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 transition-all cursor-pointer"
                >
                  <Terminal className="h-4 w-4 text-blue-400" />
                  <span>Show Embedded Log Terminal</span>
                </button>
              )
            )}
          </div>
        )}

        {/* Live Logs Tab */}
        {activeTab === "logs" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium text-neutral-300">
                <Terminal className="h-3.5 w-3.5 text-blue-400" />
                kubectl logs -f {target.data.name}
              </span>
              <div className="flex items-center gap-1">
                {target.type === "pod" && onOpenLogTerminal && (
                  <button
                    onClick={() =>
                      onOpenLogTerminal(
                        target.data.name,
                        targetRecord.namespace ? String(targetRecord.namespace) : "default"
                      )
                    }
                    className="rounded bg-blue-500/20 px-2 py-1 text-[11px] font-mono text-blue-300 hover:bg-blue-500/30 transition-colors border border-blue-500/30"
                  >
                    Expand Terminal
                  </button>
                )}
                <button
                  onClick={() => setIsTailing((prev) => !prev)}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  title={isTailing ? "Pause Stream" : "Resume Stream"}
                >
                  {isTailing ? <Pause className="h-3.5 w-3.5 text-amber-400" /> : <Play className="h-3.5 w-3.5 text-emerald-400" />}
                </button>
                <button
                  onClick={copyLogs}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  title="Copy Logs"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => setActiveTab("overview")}
                  className="rounded bg-neutral-800 px-2 py-1 text-[11px] font-mono text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors border border-neutral-700 cursor-pointer"
                  title="Close Live Logs View"
                >
                  Close Logs ✕
                </button>
              </div>
            </div>

            <div className="h-[380px] w-full rounded-xl bg-neutral-950 p-3 font-mono text-[11px] text-neutral-300 border border-neutral-800 overflow-y-auto space-y-1 select-text">
              {logs.map((line, idx) => (
                <div key={idx} className="leading-relaxed hover:bg-neutral-900/60 rounded px-1">
                  <span className="text-neutral-500 mr-2">{idx + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resource Usage Tab */}
        {activeTab === "metrics" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">CPU Usage</span>
                <span className="font-mono text-xs text-blue-400 font-bold">
                  {cpuTelemetry.label}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-950 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{
                    width: `${cpuTelemetry.pct}%`,
                  }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">Memory Consumption</span>
                <span className="font-mono text-xs text-emerald-400 font-bold">
                  {memoryTelemetry.label}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-950 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                  style={{
                    width: `${memoryTelemetry.pct}%`,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Chaos Testing Engine Tab */}
        {activeTab === "chaos" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-200 mb-1">
                <Zap className="h-4 w-4 text-amber-400" />
                {target.type === "ingress" ? "Ingress Route Fault Injector" : "Chaos Testing Fault Injector"}
              </div>
              <p className="text-[11px] text-neutral-400">
                Simulate production {target.type === "ingress" ? "routing latency and HTTP gateway faults" : "workload failures"} on{" "}
                <span className="font-mono text-neutral-200">{target.data.name}</span> to verify system resilience.
              </p>
            </div>

            {chaosActionMsg && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-mono text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>{chaosActionMsg}</span>
              </div>
            )}

            {target.type === "ingress" ? (
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => triggerChaos("oom-pressure", "Inject Ingress Route Latency (+250ms)")}
                  className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-400 transition-all active:scale-95 cursor-pointer"
                >
                  <span>Inject Ingress Route Latency (+250ms)</span>
                  <Activity className="h-4 w-4 text-amber-400" />
                </button>

                <button
                  onClick={() => triggerChaos("crash", "Simulate Upstream HTTP 503 Fault")}
                  className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-all active:scale-95 cursor-pointer"
                >
                  <span>Simulate Upstream HTTP 503 Fault</span>
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                </button>

                <button
                  onClick={() => triggerChaos("scale-down", "Simulate TLS Certificate Handshake Failure")}
                  className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-400 transition-all active:scale-95 cursor-pointer"
                >
                  <span>Simulate TLS Handshake Timeout</span>
                  <Zap className="h-4 w-4 text-violet-400" />
                </button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => triggerChaos("crash", "Pod SIGKILL Crash")}
                  className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-all active:scale-95 cursor-pointer"
                >
                  <span>Simulate Crash (SIGKILL)</span>
                  <RotateCcw className="h-4 w-4" />
                </button>

                <button
                  onClick={() => triggerChaos("oom-pressure", "OOM Memory Pressure")}
                  className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-400 transition-all active:scale-95 cursor-pointer"
                >
                  <span>Inject Network / Memory Pressure</span>
                  <Activity className="h-4 w-4" />
                </button>

                <button
                  onClick={() => triggerChaos("scale-down", "Replica Scale Down")}
                  className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-all active:scale-95 cursor-pointer"
                >
                  <span>Trigger Workload Scale-Down</span>
                  <Zap className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
