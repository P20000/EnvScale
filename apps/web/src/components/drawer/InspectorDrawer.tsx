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
import type { K8sPodData } from "../nodes/K8sPod";
import type { K8sNodeData } from "../nodes/K8sNode";
import type { K8sServiceData } from "../nodes/K8sService";

type SelectedTarget =
  | { type: "pod"; data: K8sPodData }
  | { type: "node"; data: K8sNodeData }
  | { type: "service"; data: K8sServiceData }
  | null;

interface InspectorDrawerProps {
  target: SelectedTarget;
  onClose: () => void;
}

export function InspectorDrawer({ target, onClose }: InspectorDrawerProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "logs" | "metrics" | "chaos">("overview");
  const [logs, setLogs] = useState<string[]>([]);
  const [isTailing, setIsTailing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [chaosActionMsg, setChaosActionMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const name = target.data.name;
    const initial = [
      `[INFO] ${new Date().toISOString()} Starting container process for ${name}...`,
      `[INFO] ${new Date().toISOString()} Listening on port 8080 (0.0.0.0)`,
      `[DEBUG] ${new Date().toISOString()} Health check endpoint GET /healthz 200 OK`,
    ];
    setLogs(initial);
  }, [target]);

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

  if (!target) return null;

  const targetRecord = target.data as Record<string, any>;

  const triggerChaos = (action: string) => {
    setChaosActionMsg(`Triggering ${action} on ${target.data.name}...`);
    setTimeout(() => {
      setChaosActionMsg(`[CHAOS FAULT INJECTED]: ${action} applied successfully.`);
      setTimeout(() => setChaosActionMsg(null), 3000);
    }, 1200);
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
                  <span className="text-neutral-200">minikube-worker-1</span>
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
                <span className="font-mono text-xs text-blue-400 font-bold">142 mcores (14.2%)</span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-950 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 w-[14%]" />
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-300">Memory Consumption</span>
                <span className="font-mono text-xs text-emerald-400 font-bold">256 MiB / 512 MiB (50%)</span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-950 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500 w-[50%]" />
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
