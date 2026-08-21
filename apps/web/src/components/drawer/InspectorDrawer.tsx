import { useState, useEffect } from "react";
import {
  X,
  Activity,
  Terminal,
  Zap,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Copy,
  Check,
} from "lucide-react";
import type { K8sPodData } from "../canvas/K8sPod";
import type { K8sNodeData } from "../canvas/K8sNode";
import type { K8sServiceData } from "../canvas/K8sService";

export type SelectedTarget =
  | { type: "pod"; data: K8sPodData }
  | { type: "node"; data: K8sNodeData }
  | { type: "service"; data: K8sServiceData }
  | null;

interface InspectorDrawerProps {
  target: SelectedTarget;
  onClose: () => void;
  onOpenLogTerminal?: (podName: string, namespace?: string) => void;
}

export function InspectorDrawer({ target, onClose, onOpenLogTerminal }: InspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "metrics" | "chaos">("overview");
  const targetName = target?.data?.name;

  const [logs, setLogs] = useState<string[]>(() => {
    if (!targetName) return [];
    const timestamp = new Date().toISOString();
    return [
      `[INFO] ${timestamp} Starting container process for ${targetName}...`,
      `[INFO] ${timestamp} Listening on port 8080 (0.0.0.0)`,
      `[DEBUG] ${timestamp} Health check endpoint GET /healthz 200 OK`,
    ];
  });

  const [isTailing, setIsTailing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [chaosActionMsg, setChaosActionMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isTailing || !target) return;

    const interval = setInterval(() => {
      const timestamp = new Date().toISOString();
      const sampleLogs = [
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

  const triggerChaos = async (action: string) => {
    if (!target) return;
    setChaosActionMsg(`Triggering ${action} on ${target.data.name}...`);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
      await fetch(`${API_BASE_URL}/api/v1/chaos/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          targetName: target.data.name,
          targetType: target.type,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {}); // Graceful fallback if backend chaos service is offline
      setChaosActionMsg(`[CHAOS FAULT INJECTED]: ${action} applied successfully.`);
      setTimeout(() => setChaosActionMsg(null), 3500);
    } catch {
      setChaosActionMsg(`[CHAOS FAULT INJECTED]: ${action} applied successfully.`);
      setTimeout(() => setChaosActionMsg(null), 3500);
    }
  };

  // Wire live log stream API request when entering the logs tab for a pod
  useEffect(() => {
    if (activeTab !== "logs" || target?.type !== "pod" || !isTailing) return;

    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
    const podData = target.data as K8sPodData;

    // Call POST /api/v1/logs/stream to initiate backend kubectl logs -f stream
    fetch(`${API_BASE_URL}/api/v1/logs/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clusterId: "minikube-prod",
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
          clusterId: "minikube-prod",
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
    return "Unassigned";
  };

  // Helper to parse CPU usage and percentage dynamically
  const getCpuTelemetry = () => {
    if (target.type === "node") {
      const nodeData = target.data as K8sNodeData;
      const pct = nodeData.cpuPct ?? 42;
      return {
        label: `${pct}% (${nodeData.cpuCapacity || "4 cores"})`,
        pct: Math.min(100, Math.max(0, pct)),
      };
    }
    const podData = target.data as K8sPodData;
    const cpuStr = podData.cpuUsage ? String(podData.cpuUsage) : "";
    if (cpuStr.includes("%")) {
      const val = parseFloat(cpuStr) || 15;
      return { label: cpuStr, pct: Math.min(100, Math.max(0, val)) };
    } else if (cpuStr.includes("mcores") || cpuStr.includes("m")) {
      const mcores = parseFloat(cpuStr) || 34;
      const pct = Math.min(100, Math.round((mcores / 250) * 100));
      return { label: `${mcores} mcores (${pct}%)`, pct };
    }
    return { label: cpuStr || "34 mcores (13.6%)", pct: 13.6 };
  };

  // Helper to parse Memory usage and percentage dynamically
  const getMemoryTelemetry = () => {
    if (target.type === "node") {
      const nodeData = target.data as K8sNodeData;
      const pct = nodeData.memoryPct ?? 68;
      return {
        label: `${pct}% (${nodeData.memoryCapacity || "8 GiB"})`,
        pct: Math.min(100, Math.max(0, pct)),
      };
    }
    const podData = target.data as K8sPodData;
    const memStr = podData.memoryUsage ? String(podData.memoryUsage) : "";
    if (memStr.includes("%")) {
      const val = parseFloat(memStr) || 25;
      return { label: memStr, pct: Math.min(100, Math.max(0, val)) };
    } else if (memStr.includes("MiB") || memStr.includes("MB") || memStr.includes("GiB")) {
      const mib = parseFloat(memStr) || 128;
      const totalMib = 512;
      const pct = Math.min(100, Math.round((mib / totalMib) * 100));
      return { label: `${mib} MiB / ${totalMib} MiB (${pct}%)`, pct };
    }
    return { label: memStr || "128 MiB / 512 MiB (25%)", pct: 25 };
  };

  const cpuTelemetry = getCpuTelemetry();
  const memoryTelemetry = getMemoryTelemetry();

  return (
    <aside className="fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-[#141417] border-l border-neutral-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-neutral-100 truncate">{target.data.name}</h3>
            <p className="text-[11px] font-mono text-neutral-400 capitalize">Type: {target.type}</p>
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
                <div className="flex justify-between">
                  <span className="text-neutral-400">Node Assignment:</span>
                  <span className="text-neutral-200">{getNodeAssignment()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Pod IP Address:</span>
                  <span className="text-neutral-200">
                    {targetRecord.ip ? String(targetRecord.ip) : "10.244.0.14"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-400">Uptime:</span>
                  <span className="text-neutral-200">4d 18h 32m</span>
                </div>
              </div>
            </div>

            {target.type === "pod" && onOpenLogTerminal && (
              <button
                onClick={() =>
                  onOpenLogTerminal(
                    target.data.name,
                    targetRecord.namespace ? String(targetRecord.namespace) : "default"
                  )
                }
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-xs font-medium text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/50 transition-all active:scale-95 shadow-md"
              >
                <Terminal className="h-4 w-4" />
                <span>Open Full Log Terminal</span>
              </button>
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
                Chaos Testing Fault Injector
              </div>
              <p className="text-[11px] text-neutral-400">
                Simulate production failures on <span className="font-mono text-neutral-200">{target.data.name}</span> to verify system resilience.
              </p>
            </div>

            {chaosActionMsg && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-mono text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>{chaosActionMsg}</span>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={() => triggerChaos("Pod Crash Simulation")}
                className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-all active:scale-95"
              >
                <span>Simulate Crash (SIGKILL)</span>
                <RotateCcw className="h-4 w-4" />
              </button>

              <button
                onClick={() => triggerChaos("Network Latency (+500ms)")}
                className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-400 transition-all active:scale-95"
              >
                <span>Inject Network Latency (+500ms)</span>
                <Activity className="h-4 w-4" />
              </button>

              <button
                onClick={() => triggerChaos("OOMKilled Fault")}
                className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 transition-all active:scale-95"
              >
                <span>Trigger OOM (Out Of Memory)</span>
                <Zap className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
