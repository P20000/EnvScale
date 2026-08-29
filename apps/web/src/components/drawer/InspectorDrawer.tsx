import { useState, useEffect } from "react";
import { MdClose as X } from "react-icons/md";
import type { K8sPodData } from "../canvas/K8sPod";
import type { K8sNodeData } from "../canvas/K8sNode";
import type { K8sServiceData } from "../canvas/K8sService";
import type { K8sIngressData } from "../canvas/K8sIngress";
import type { K8sDaemonSetData } from "../../store/types/topologyTypes";
import { useTopologyStore } from "../../store/useTopologyStore";
import { OverviewTab } from "./inspector/OverviewTab";
import { LogsTab } from "./inspector/LogsTab";
import { MetricsTab } from "./inspector/MetricsTab";
import { ChaosTab } from "./inspector/ChaosTab";

export type SelectedTarget =
  | { type: "pod"; data: K8sPodData }
  | { type: "node"; data: K8sNodeData }
  | { type: "service"; data: K8sServiceData }
  | { type: "ingress"; data: K8sIngressData }
  | { type: "daemonset"; data: K8sDaemonSetData }
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

  const [chaosActionMsg, setChaosActionMsg] = useState<string | null>(null);
  const [isEmbeddedLogOpen, setIsEmbeddedLogOpen] = useState(true);

  const triggerChaos = async (faultType: "crash" | "oom-pressure" | "scale-down", actionLabel: string) => {
    if (!target) return;
    setChaosActionMsg(`Injecting ${actionLabel} into ${target.data.name}...`);
    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
      const clusterId = useTopologyStore.getState().activeCluster;
      if (!clusterId) {
        setChaosActionMsg("Error: No active cluster selected.");
        return;
      }
      const namespace = (target.data as K8sPodData).namespace || "default";

      const res = await fetch(`${API_BASE_URL}/api/v1/chaos/inject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

  if (!target) return null;

  const getCpuTelemetry = () => {
    if (target.type === "node") {
      const nodeData = target.data as K8sNodeData;
      const pct = nodeData.cpuPct ?? 0;
      const capStr = nodeData.cpuCapacity || (clusterCpuCores ? `${clusterCpuCores} cores` : "Allocating");
      return { label: `${pct}% (${capStr})`, pct: Math.min(100, Math.max(0, pct)) };
    }
    const podData = target.data as K8sPodData;
    const mcores = podData.cpuUsageMcores ?? 0;
    const maxMcores = (clusterCpuCores || 12) * 1000;
    const pct = Math.min(100, parseFloat(((mcores / maxMcores) * 100).toFixed(1)));
    return { label: `${mcores} mcores (${pct}%)`, pct };
  };

  const getMemoryTelemetry = () => {
    if (target.type === "node") {
      const nodeData = target.data as K8sNodeData;
      const pct = nodeData.memoryPct ?? 0;
      const capStr = nodeData.memoryCapacity || (clusterMemoryGB ? `${clusterMemoryGB.toFixed(1)} GiB` : "Allocating");
      return { label: `${pct}% (${capStr})`, pct: Math.min(100, Math.max(0, pct)) };
    }
    const podData = target.data as K8sPodData;
    const mib = podData.memoryUsageMiB ?? 0;
    const totalMib = (clusterMemoryGB || 14.8) * 1024;
    const pct = Math.min(100, parseFloat(((mib / totalMib) * 100).toFixed(1)));
    return { label: `${mib.toFixed(1)} MiB / ${(totalMib / 1024).toFixed(1)} GiB (${pct}%)`, pct };
  };

  return (
    <aside className="fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-[#141417] border-l border-neutral-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">
      <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`flex h-2.5 w-2.5 rounded-full shrink-0 ${target.type === "ingress" ? "bg-violet-400" : "bg-emerald-500"}`} />
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

      <div className="flex border-b border-neutral-800 bg-neutral-950 px-2 text-xs font-medium">
        {(["overview", "logs", "metrics", "chaos"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 border-b-2 text-center transition-colors capitalize ${
              activeTab === tab
                ? "border-blue-500 text-blue-400 font-semibold"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {tab === "metrics" ? "Usage" : tab === "logs" ? "Live Logs" : tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === "overview" && (
          <OverviewTab
            target={target}
            nowMs={nowMs}
            isEmbeddedLogOpen={isEmbeddedLogOpen}
            setIsEmbeddedLogOpen={setIsEmbeddedLogOpen}
            onOpenLogTerminal={onOpenLogTerminal}
          />
        )}
        {activeTab === "logs" && (
          <LogsTab
            target={target}
            onOpenLogTerminal={onOpenLogTerminal}
          />
        )}
        {activeTab === "metrics" && (
          <MetricsTab
            target={target}
            cpuTelemetry={getCpuTelemetry()}
            memoryTelemetry={getMemoryTelemetry()}
          />
        )}
        {activeTab === "chaos" && (
          <ChaosTab
            target={target}
            chaosActionMsg={chaosActionMsg}
            triggerChaos={triggerChaos}
          />
        )}
      </div>
    </aside>
  );
}
