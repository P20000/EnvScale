import { Icon } from "../ui/Icon";
import {
  mdiChartLine,
  mdiCpu64Bit,
  mdiMemory,
  mdiFlash,
} from "@mdi/js";

export function MetricsView() {
  return (
    <div className="h-screen w-full max-w-7xl pt-20 pl-20 pr-6 pb-14 mx-auto space-y-8 bg-background overflow-y-auto">
      <div>
        <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2.5 font-heading">
          <Icon path={mdiChartLine} size={1} className="text-blue-500" />
          Metrics Inspector
        </h1>
        <p className="text-sm text-neutral-400 mt-1.5">
          Cluster-wide resource utilization, CPU mcore telemetry, and RAM pressure analysis
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* CPU Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Icon path={mdiCpu64Bit} size={0.83} className="text-blue-400" />
              <h3 className="text-base font-semibold text-neutral-200 font-heading">Aggregate CPU Usage</h3>
            </div>
            <span className="font-mono text-base text-blue-400 font-bold">1.42 / 4.0 Cores (35.5%)</span>
          </div>

          <div className="h-52 w-full rounded-xl bg-background p-4 border border-neutral-800 flex items-end gap-2.5">
            {[40, 55, 30, 65, 80, 45, 35, 50, 60, 42, 38, 52, 70, 48, 35.5].map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div
                  className="w-full rounded-t-sm bg-blue-500/80 group-hover:bg-blue-400 transition-colors"
                  style={{ height: `${val}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Memory Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-surface p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Icon path={mdiMemory} size={0.83} className="text-emerald-400" />
              <h3 className="text-base font-semibold text-neutral-200 font-heading">RAM Consumption</h3>
            </div>
            <span className="font-mono text-base text-emerald-400 font-bold">4.8 GB / 8.0 GB (60%)</span>
          </div>

          <div className="h-52 w-full rounded-xl bg-background p-4 border border-neutral-800 flex items-end gap-2.5">
            {[50, 52, 55, 58, 62, 60, 61, 63, 60, 59, 62, 64, 60, 58, 60].map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div
                  className="w-full rounded-t-sm bg-emerald-500/80 group-hover:bg-emerald-400 transition-colors"
                  style={{ height: `${val}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2 font-heading">
          <Icon path={mdiFlash} size={0.7} className="text-amber-400" />
          Top Resource Consuming Pods
        </h3>
        <div className="space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-md bg-background border border-neutral-800">
            <span className="text-neutral-200 font-medium">auth-service-5d6c8b-p9x1</span>
            <span className="text-blue-400">420 mcores</span>
            <span className="text-emerald-400">312 MiB</span>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-md bg-background border border-neutral-800">
            <span className="text-neutral-200 font-medium">postgres-db-0</span>
            <span className="text-blue-400">380 mcores</span>
            <span className="text-emerald-400">1024 MiB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
