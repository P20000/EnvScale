import { useState, useEffect, useMemo } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiChartLine,
  mdiCpu64Bit,
  mdiMemory,
  mdiFlash,
  mdiServer,
  mdiRefresh,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";

function TelemetryAreaChart({
  data,
  color,
  unit,
}: {
  data: number[];
  color: "blue" | "emerald";
  unit: string;
}) {
  const maxVal = Math.max(...data, 100);
  const pointCoords = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * 100;
    const y = 100 - (val / maxVal) * 80 - 5; // keep within 5% to 85% range
    return { x: x.toFixed(2), y: y.toFixed(2), rawVal: val };
  });

  const linePathString = pointCoords.reduce((acc, p, idx) => {
    return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  const areaPathString = `${linePathString} L 100 100 L 0 100 Z`;

  const strokeHex = color === "blue" ? "#3b82f6" : "#10b981";
  const areaFillHex = color === "blue" ? "rgba(59, 130, 246, 0.08)" : "rgba(16, 185, 129, 0.08)";

  return (
    <div className="relative h-56 w-full rounded-xl bg-background p-4 border border-neutral-800 flex flex-col justify-between overflow-hidden">
      {/* Y-Axis Labels & Background Grid Lines */}
      <div className="absolute inset-x-4 top-4 bottom-8 flex flex-col justify-between pointer-events-none z-0">
        <div className="w-full border-b border-neutral-800/80 flex items-center justify-between">
          <span className="text-[9px] font-mono text-neutral-500 select-none">100%</span>
        </div>
        <div className="w-full border-b border-neutral-800/80 flex items-center justify-between">
          <span className="text-[9px] font-mono text-neutral-500 select-none">50%</span>
        </div>
        <div className="w-full border-b border-neutral-800/80 flex items-center justify-between">
          <span className="text-[9px] font-mono text-neutral-500 select-none">0%</span>
        </div>
      </div>

      {/* Histogram Bar Overlay */}
      <div className="absolute left-11 right-4 top-4 bottom-8 flex items-end gap-1.5 z-10">
        {data.map((val, i) => (
          <div key={i} className="flex-1 h-full flex flex-col justify-end group relative cursor-pointer">
            {/* Tooltip on hover */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-40 rounded bg-[#18181c] border border-neutral-700 px-2 py-1 text-[10px] font-mono text-neutral-100 shadow-xl whitespace-nowrap pointer-events-none font-heading">
              {val.toFixed(1)}{unit}
            </div>
            <div
              className={`w-full rounded-t-xs transition-all duration-300 ${
                color === "blue"
                  ? "bg-blue-500/15 group-hover:bg-blue-500/40"
                  : "bg-emerald-500/15 group-hover:bg-emerald-500/40"
              }`}
              style={{ height: `${Math.max((val / maxVal) * 80, 4)}%` }}
            />
          </div>
        ))}
      </div>

      {/* Prominent Floating SVG Line Chart Layer (Rendered ON TOP of bars) */}
      <div className="absolute left-11 right-4 top-4 bottom-8 z-30 pointer-events-none">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* 1. Muted Area Fill */}
          <path d={areaPathString} fill={areaFillHex} stroke="none" />

          {/* 2. Crisp Vibrant Trend Line */}
          <path
            d={linePathString}
            fill="none"
            stroke={strokeHex}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* 3. Highlight Vertices */}
          {pointCoords.map((p, i) => (
            <circle
              key={i}
              cx={`${p.x}%`}
              cy={`${p.y}%`}
              r="2.5"
              fill={strokeHex}
              stroke="#09090b"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>

      {/* X-axis Timeline Labels */}
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 pt-2 pl-7 border-t border-neutral-800/80 z-20">
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

  // Dynamic telemetry stream data state
  const [cpuHistory, setCpuHistory] = useState<number[]>([
    28, 35, 42, 38, 55, 62, 48, 40, 52, 68, 74, 58, 45, 50, 35.5,
  ]);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([
    48, 50, 52, 55, 58, 62, 60, 61, 63, 60, 59, 62, 64, 60, 60.0,
  ]);

  // Live telemetry pulse simulator
  useEffect(() => {
    const interval = setInterval(() => {
      setCpuHistory((prev) => {
        const nextVal = Math.min(95, Math.max(15, prev[prev.length - 1] + (Math.random() * 12 - 6)));
        return [...prev.slice(1), nextVal];
      });
      setMemoryHistory((prev) => {
        const nextVal = Math.min(92, Math.max(30, prev[prev.length - 1] + (Math.random() * 6 - 3)));
        return [...prev.slice(1), nextVal];
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Compute live CPU & RAM usage from active pods
  const podResourceMetrics = useMemo(() => {
    if (pods.length === 0) {
      // Fallback display list if no pods streamed yet
      return [
        { name: "auth-service-5d6c8b-p9x1", namespace: "default", mcores: 420, memoryMiB: 312, status: "Running" },
        { name: "postgres-db-0", namespace: "default", mcores: 380, memoryMiB: 1024, status: "Running" },
        { name: "todo-backend-canary-786594868-9z4hx", namespace: "testing-todo", mcores: 260, memoryMiB: 245, status: "Running" },
        { name: "redis-db-0", namespace: "testing-todo", mcores: 180, memoryMiB: 128, status: "Running" },
      ];
    }

    return pods
      .map((pod) => {
        const hash = pod.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const mcores = (hash % 350) + 80;
        const memoryMiB = (hash % 400) + 120;
        return {
          name: pod.name,
          namespace: pod.namespace || "default",
          mcores,
          memoryMiB,
          status: pod.status,
        };
      })
      .sort((a, b) => b.mcores - a.mcores);
  }, [pods]);

  const currentCpuPct = cpuHistory[cpuHistory.length - 1];
  const currentMemoryPct = memoryHistory[memoryHistory.length - 1];

  const totalMcores = useMemo(() => {
    const sum = podResourceMetrics.reduce((acc, p) => acc + p.mcores, 0);
    return (sum / 1000).toFixed(2);
  }, [podResourceMetrics]);

  const totalRamGB = useMemo(() => {
    const sumMiB = podResourceMetrics.reduce((acc, p) => acc + p.memoryMiB, 0);
    return (sumMiB / 1024).toFixed(1);
  }, [podResourceMetrics]);

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
              setCpuHistory((prev) => [...prev.slice(1), Math.random() * 40 + 30]);
              setMemoryHistory((prev) => [...prev.slice(1), Math.random() * 20 + 50]);
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
            <div className="flex items-center gap-2">
              <Icon path={mdiCpu64Bit} size={0.8} className="text-neutral-400" />
              <div>
                <h3 className="text-sm font-semibold text-neutral-200 font-heading">Aggregate CPU Usage</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Total mcore workload allocation</p>
              </div>
            </div>
            <div className="text-right font-mono flex items-center gap-2">
              <div>
                <div className="text-base text-neutral-100 font-semibold">{totalMcores} / 4.0 Cores</div>
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
          />
        </div>

        {/* Memory Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Icon path={mdiMemory} size={0.8} className="text-neutral-400" />
              <div>
                <h3 className="text-sm font-semibold text-neutral-200 font-heading">RAM Consumption</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Memory working set pressure</p>
              </div>
            </div>
            <div className="text-right font-mono flex items-center gap-2">
              <div>
                <div className="text-base text-neutral-100 font-semibold">{totalRamGB} GB / 8.0 GB</div>
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
          />
        </div>
      </div>

      {/* Top Resource Consuming Pods Table */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2 font-heading">
            <Icon path={mdiFlash} size={0.7} className="text-amber-400" />
            <span>Top Resource Consuming Pods</span>
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
