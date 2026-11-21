import { memo } from "react";
import { MdDns as NodeIcon } from "react-icons/md";
import { Server } from "lucide-react";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useUIStore } from "../../store/useUIStore";
import { formatNodeName, type K8sNodeBoundaryData } from "../../utils/nodeBoundaryHelpers";
import type { K8sNodeData } from "./K8sNode";

export function K8sNodeBoundaryComponent({ data }: { data: K8sNodeBoundaryData }) {
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const rawNodes = useTopologyStore((s) => s.rawNodes);
  const setHoveredNodeName = useUIStore((s) => s.setHoveredNodeName);
  const hoveredNodeName = useUIStore((s) => s.hoveredNodeName);

  const isHealthy = data.status === "Ready" || data.status === "Running";
  const isHovered = hoveredNodeName === data.nodeName;

  const handleHeaderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const matchedWorker = rawNodes.find(
      (n) => n.id === `node-${data.nodeName}` || (n.data as K8sNodeData)?.name === data.nodeName
    );

    setSelectedNode({
      type: "node",
      data: (matchedWorker?.data as K8sNodeData) || ({
        name: data.nodeName,
        ip: "10.0.0.1",
        cpuPct: data.cpuPct,
        memoryPct: data.memoryPct,
        status: isHealthy ? "Ready" : "NotReady",
      } as K8sNodeData),
    });
  };

  const isAwsZone = data.zone.includes("-") && (data.zone.includes("east") || data.zone.includes("west") || data.zone.includes("south") || data.zone.includes("central"));

  return (
    <div
      className={`w-full h-full rounded-2xl border-2 border-dashed transition-colors duration-150 pointer-events-none select-none relative ${
        isHovered
          ? "border-emerald-500/70 bg-[#12141a]/60 shadow-[0_0_20px_rgba(16,185,129,0.15)]"
          : "border-[#2b303d] bg-[#12141a]/40"
      }`}
    >
      {/* Interactive Node Header Banner */}
      <div
        onClick={handleHeaderClick}
        onMouseEnter={() => setHoveredNodeName(data.nodeName)}
        onMouseLeave={() => setHoveredNodeName(null)}
        className="pointer-events-auto absolute top-0 left-0 right-0 h-10 px-3.5 flex items-center justify-between rounded-t-2xl border-b border-[#2b303d]/70 bg-[#181b22] hover:bg-[#1f232d] transition-colors cursor-pointer group"
        title={`Click to inspect worker node: ${data.nodeName}`}
      >
        {/* Left: Icon, Node Name, Role, and AWS Zone */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded-md bg-[#232732] border border-[#333846] flex items-center justify-center shrink-0 text-neutral-300">
            {data.role === "control-plane" ? <Server className="w-3 h-3 text-purple-400" /> : <NodeIcon className="text-xs text-blue-400" />}
          </div>

          <span
            className="text-xs font-mono font-bold text-neutral-200 tracking-tight truncate max-w-[220px]"
            title={`Worker node: ${data.nodeName}`}
          >
            {formatNodeName(data.nodeName)}
          </span>

          {/* Node Role Tag */}
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold shrink-0 ${
              data.role === "control-plane"
                ? "bg-purple-500/15 border-purple-500/30 text-purple-300"
                : "bg-blue-500/15 border-blue-500/30 text-blue-300"
            }`}
          >
            {data.role === "control-plane" ? "Control Plane" : "Worker"}
          </span>

          {/* AWS Availability Zone Tag */}
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-tight font-medium shrink-0 flex items-center gap-1 ${
              isAwsZone
                ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {data.zone}
          </span>

          {/* Instance Type */}
          {data.instanceType && data.instanceType !== "standard" && (
            <span className="text-[9px] font-mono text-neutral-400 px-1 rounded bg-[#232732] border border-[#333846] shrink-0">
              {data.instanceType}
            </span>
          )}
        </div>

        {/* Right: Allocation & Health Status */}
        <div className="flex items-center gap-2.5 shrink-0 text-[10px] font-mono">
          <span className="text-neutral-400">
            <strong className="text-neutral-200">{data.podCount}</strong> / {data.podCapacity} Pods
          </span>

          <span className="text-neutral-500">•</span>

          <span className="text-neutral-400">
            CPU <strong className="text-cyan-300">{data.cpuPct}%</strong>
          </span>

          <span className="text-neutral-500">•</span>

          <span className="text-neutral-400">
            MEM <strong className="text-indigo-300">{data.memoryPct}%</strong>
          </span>

          {/* Health Pill */}
          <div
            className={`h-5 px-2 rounded inline-flex items-center gap-1 font-bold leading-none shrink-0 ${
              isHealthy
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? "bg-emerald-400" : "bg-rose-400"}`} />
            {isHealthy ? "READY" : "NOT READY"}
          </div>
        </div>
      </div>
    </div>
  );
}

export const K8sNodeBoundaryNode = memo(K8sNodeBoundaryComponent);
K8sNodeBoundaryNode.displayName = "K8sNodeBoundaryNode";
