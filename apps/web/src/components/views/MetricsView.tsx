import { useState, useEffect, useMemo, useRef } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiChartLine,
  mdiCpu64Bit,
  mdiMemory,
  mdiServer,
  mdiRefresh,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";

function TelemetryAreaChart({
  data,
  color,
  unit,
  title,
}: {
  data: number[];
  color: "blue" | "emerald";
  unit: string;
  title: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const pointCoords = useMemo(() => {
    return data.map((val, idx) => {
      const x = (idx / (data.length - 1)) * 100;
      // Clamp Y coordinate strictly within 0% (y = 100) to 100% (y = 0)
      const clampedVal = Math.min(100, Math.max(0, val));
      const y = 100 - clampedVal;
      return { x, y, rawVal: val, idx };
    });
  }, [data]);

  const linePathString = useMemo(() => {
    return pointCoords.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `${acc} L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    }, "");
  }, [pointCoords]);

  const areaPathString = `${linePathString} L 100 100 L 0 100 Z`;

  const strokeHex = color === "blue" ? "#3b82f6" : "#10b981";
  const areaFillHex = color === "blue" ? "rgba(59, 130, 246, 0.08)" : "rgba(16, 185, 129, 0.08)";

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, mouseX / rect.width));
    const closestIdx = Math.round(pct * (data.length - 1));
    setHoverIndex(closestIdx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoveredPoint = hoverIndex !== null ? pointCoords[hoverIndex] : null;

  return (
    <div className="relative w-full rounded-xl bg-background p-4 border border-neutral-800 space-y-2 select-none">
      {/* Upper Chart Container with Y-Axis and Plot Box */}
      <div className="flex h-44 w-full relative">
        {/* Y-Axis Labels (Left) */}
        <div className="w-8 h-full flex flex-col justify-between py-0 text-[9px] font-mono text-neutral-500 pr-2 select-none">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>

        {/* Plot Box Area (Bounded Grid + SVG Line) */}
        <div
          className="flex-1 h-full relative overflow-hidden"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Horizontal Grid Lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none z-0">
            <div className="w-full border-b border-neutral-800/80" />
            <div className="w-full border-b border-neutral-800/80" />
            <div className="w-full border-b border-neutral-800/80" />
          </div>

          {/* Vertical Technical Gridlines (Dashed) */}
          <div className="absolute inset-0 flex justify-between pointer-events-none z-0 px-[25%]">
            <div className="h-full border-r border-dashed border-neutral-800/80" />
            <div className="h-full border-r border-dashed border-neutral-800/80" />
          </div>

          {/* SVG Continuous Line Canvas */}
          <svg className="w-full h-full overflow-visible z-10 relative" viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* 1. Muted Micro-Opacity Area Fill */}
            <path d={areaPathString} fill={areaFillHex} stroke="none" />

            {/* 2. Sharp 1.5px Continuous Line Chart */}
            <path
              d={linePathString}
              fill="none"
              stroke={strokeHex}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          {/* Hover Vertex Highlight Circle (HTML div to prevent SVG aspect-ratio distortion) */}
          {hoveredPoint && (
            <div
              className="absolute h-2.5 w-2.5 rounded-full -translate-x-1/2 -translate-y-1/2 border border-[#09090b] pointer-events-none z-25 shadow-md"
              style={{
                left: `${hoveredPoint.x}%`,
                top: `${hoveredPoint.y}%`,
                backgroundColor: strokeHex,
              }}
            />
          )}

          {/* Flat Hover-Crosshair Tracking Guide Line */}
          {hoveredPoint && (
            <div
              className="absolute top-0 bottom-0 border-l border-dashed border-neutral-500 pointer-events-none z-20"
              style={{ left: `${hoveredPoint.x}%` }}
            />
          )}

          {/* Hover Precision Tooltip Card */}
          {hoveredPoint && (
            <div
              className="absolute z-30 rounded-md bg-[#18181c] border border-neutral-700 p-2 shadow-2xl pointer-events-none font-mono text-xs space-y-0.5"
              style={{
                top: "0.5rem",
                left: hoveredPoint.x > 70 ? "auto" : `calc(${hoveredPoint.x}% + 0.5rem)`,
                right: hoveredPoint.x > 70 ? `calc(100% - ${hoveredPoint.x}% + 0.5rem)` : "auto",
              }}
            >
              <div className="text-[10px] text-neutral-400 font-heading uppercase">{title}</div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${color === "blue" ? "bg-blue-400" : "bg-emerald-400"}`} />
                <span className="text-neutral-100 font-bold">{hoveredPoint.rawVal.toFixed(1)}{unit}</span>
              </div>
              <div className="text-[9px] text-neutral-500">
                {15 - Math.round((hoveredPoint.idx / (data.length - 1)) * 15)}m ago
              </div>
            </div>
          )}
        </div>
      </div>

      {/* X-axis Timeline Labels */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 pt-1.5 pl-8 border-t border-neutral-800/80">
        <span>15m ago</span>
        <span>10m ago</span>
        <span>5m ago</span>
        <span className="text-neutral-300 font-semibold">Live Now</span>
      </div>
    </div>
  );
}

export function MetricsView() {
  const pods = useTopologyStore((s) => s.pods);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const clusterCpuCores = useTopologyStore((s) => s.clusterCpuCores) || 12;
  const clusterMemoryGB = useTopologyStore((s) => s.clusterMemoryGB) || 14.8;

  // Dynamic telemetry stream data state
  const [cpuHistory, setCpuHistory] = useState<number[]>([
    5, 8, 12, 10, 15, 18, 14, 12, 16, 20, 22, 18, 15, 14, 12.5,
  ]);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([
    15, 18, 20, 22, 25, 28, 26, 24, 25, 27, 26, 25, 24, 23, 22.0,
  ]);

  // Compute live CPU & RAM usage from active pods streamed from metrics-server
  const totalCpuMcores = useMemo(() => {
    return pods.reduce((sum, p) => sum + (p.cpuUsageMcores || 0), 0);
  }, [pods]);

  const totalMemoryMiB = useMemo(() => {
    return pods.reduce((sum, p) => sum + (p.memoryUsageMiB || 0), 0);
  }, [pods]);

  const currentCpuCores = (totalCpuMcores / 1000).toFixed(2);
  const currentMemoryGB = (totalMemoryMiB / 1024).toFixed(1);

  const metricsRef = useRef({ totalCpuMcores: 0, totalMemoryMiB: 0 });

  useEffect(() => {
    metricsRef.current = { totalCpuMcores, totalMemoryMiB };
  }, [totalCpuMcores, totalMemoryMiB]);

  // Live telemetry stream updates bound directly to real metrics-server aggregate fields
  useEffect(() => {
    const interval = setInterval(() => {
      const maxMcores = clusterCpuCores * 1000;
      const maxMemoryMiB = clusterMemoryGB * 1024;
      const cpuPct = Math.min(100, Math.max(0.5, (metricsRef.current.totalCpuMcores / maxMcores) * 100));
      const memPct = Math.min(100, Math.max(0.5, (metricsRef.current.totalMemoryMiB / maxMemoryMiB) * 100));

      setCpuHistory((prev) => [...prev.slice(1), cpuPct]);
      setMemoryHistory((prev) => [...prev.slice(1), memPct]);
    }, 1000);

    return () => clearInterval(interval);
  }, [clusterCpuCores, clusterMemoryGB]);

  const podResourceMetrics = useMemo(() => {
    return pods
      .map((pod) => {
        const mcores = pod.cpuUsageMcores || 0;
        const memoryMiB = pod.memoryUsageMiB || 0;
        return {
          name: pod.name,
          namespace: pod.namespace || "default",
          mcores,
          memoryMiB: Math.round(memoryMiB),
          status: pod.status,
        };
      })
      .sort((a, b) => b.mcores - a.mcores);
  }, [pods]);

  const currentCpuPct = cpuHistory[cpuHistory.length - 1];
  const currentMemoryPct = memoryHistory[memoryHistory.length - 1];

  return (
    <div className="h-screen w-full max-w-7xl pt-20 pl-20 pr-6 pb-14 mx-auto space-y-6 bg-background overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2.5 font-heading">
            <Icon path={mdiChartLine} size={1} className="text-blue-500" />
            Metrics Inspector
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            Cluster-wide resource utilization, CPU mcore telemetry, and RAM pressure analysis.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-neutral-800 text-xs font-mono text-neutral-300">
            <Icon path={mdiServer} size={0.65} className="text-blue-400" />
            <span>{activeCluster}</span>
          </div>
          <button
            onClick={() => {
              const cpuPct = Math.min(100, Math.max(0.5, (totalCpuMcores / 4000) * 100));
              const memPct = Math.min(100, Math.max(0.5, (totalMemoryMiB / 8192) * 100));
              setCpuHistory((prev) => [...prev.slice(1), cpuPct]);
              setMemoryHistory((prev) => [...prev.slice(1), memPct]);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-neutral-100 hover:border-neutral-700 transition-colors"
            title="Refresh Telemetry Stream"
          >
            <Icon path={mdiRefresh} size={0.65} className="text-neutral-400" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CPU Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center shrink-0 w-5 h-5 text-neutral-400">
                <Icon path={mdiCpu64Bit} size={0.85} className="text-neutral-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-200 font-heading">Aggregate CPU Usage</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Total mcore workload allocation</p>
              </div>
            </div>
            <div className="text-right font-mono flex items-center gap-2">
              <div>
                <div className="text-base text-neutral-100 font-semibold">{currentCpuCores} / {clusterCpuCores.toFixed(1)} Cores</div>
                <div className="text-xs text-neutral-500">({currentCpuPct.toFixed(1)}% load)</div>
              </div>
              {currentCpuPct > 85 && (
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="High CPU Load > 85%" />
              )}
            </div>
          </div>

          <TelemetryAreaChart
            data={cpuHistory}
            color="blue"
            unit="%"
            title="CPU Telemetry"
          />
        </div>

        {/* Memory Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center shrink-0 w-5 h-5 text-neutral-400">
                <Icon path={mdiMemory} size={0.85} className="text-neutral-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-200 font-heading">RAM Consumption</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Memory working set pressure</p>
              </div>
            </div>
            <div className="text-right font-mono flex items-center gap-2">
              <div>
                <div className="text-base text-neutral-100 font-semibold">{currentMemoryGB} GB / {clusterMemoryGB.toFixed(1)} GB</div>
                <div className="text-xs text-neutral-500">({currentMemoryPct.toFixed(1)}% pressure)</div>
              </div>
              {currentMemoryPct > 85 && (
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="High RAM Pressure > 85%" />
              )}
            </div>
          </div>

          <TelemetryAreaChart
            data={memoryHistory}
            color="emerald"
            unit="%"
            title="RAM Pressure"
          />
        </div>
      </div>

      {/* Top Resource Consuming Pods Table */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-200 font-heading">
            Top Resource Consuming Pods
          </h3>
          <span className="text-xs font-mono text-neutral-400">
            {podResourceMetrics.length} Pods Monitored
          </span>
        </div>

        <div className="divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-background overflow-hidden">
          <div className="px-4 py-2 text-[10px] font-bold tracking-wider uppercase text-neutral-400 flex items-center justify-between bg-neutral-900/50 font-heading">
            <span className="w-64 font-mono">Pod Resource Name</span>
            <span className="w-32 font-mono">Namespace</span>
            <span className="w-32 text-right font-mono">CPU Telemetry</span>
            <span className="w-32 text-right font-mono">Memory Pressure</span>
          </div>

          {podResourceMetrics.slice(0, 6).map((pod) => (
            <div
              key={pod.name}
              className="px-4 py-2.5 flex items-center justify-between text-xs font-mono hover:bg-neutral-900/60 transition-colors"
            >
              <span className="w-64 font-medium text-neutral-200 truncate">{pod.name}</span>
              <span className="w-32 text-neutral-400 truncate">ns/{pod.namespace}</span>
              <span className="w-32 text-right text-neutral-200 font-semibold">{pod.mcores} mcores</span>
              <span className="w-32 text-right text-neutral-200 font-semibold">{pod.memoryMiB} MiB</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
