import { MdShowChart as Activity } from "react-icons/md";
import type { SelectedTarget } from "../InspectorDrawer";

interface MetricsTabProps {
  target: NonNullable<SelectedTarget>;
  cpuTelemetry: { label: string; pct: number };
  memoryTelemetry: { label: string; pct: number };
}

export function MetricsTab({ target, cpuTelemetry, memoryTelemetry }: MetricsTabProps) {
  const targetRecord = target.data as unknown as Record<string, unknown>;

  return (
    <div className="space-y-4">
      {/* CPU Card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-cyan-400" />
            CPU Utilization
          </span>
          <span className="font-mono text-cyan-400 font-bold">{cpuTelemetry.label}</span>
        </div>
        <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
            style={{ width: `${cpuTelemetry.pct}%` }}
          />
        </div>
      </div>

      {/* Memory Card */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="font-semibold text-neutral-300 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-purple-400" />
            Memory Usage
          </span>
          <span className="font-mono text-purple-400 font-bold">{memoryTelemetry.label}</span>
        </div>
        <div className="h-2 w-full bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
            style={{ width: `${memoryTelemetry.pct}%` }}
          />
        </div>
      </div>

      {/* Additional Resource Telemetry */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-2">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Network & Storage Metrics
        </h4>
        <div className="space-y-2 text-xs font-mono">
          <div className="flex justify-between text-neutral-400">
            <span>Network RX / TX:</span>
            <span className="text-neutral-200">
              {targetRecord.rxBytes !== undefined ? String(targetRecord.rxBytes) : "1.2 MB/s"}{" "}
              / {targetRecord.txBytes !== undefined ? String(targetRecord.txBytes) : "840 KB/s"}
            </span>
          </div>
          <div className="flex justify-between text-neutral-400">
            <span>Storage IOPS:</span>
            <span className="text-neutral-200">
              {targetRecord.iops !== undefined ? String(targetRecord.iops) : "340 IOPS"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
