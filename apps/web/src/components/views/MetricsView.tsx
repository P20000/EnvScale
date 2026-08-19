import { BarChart3, Cpu, HardDrive, Zap } from "lucide-react";

export function MetricsView() {
  return (
    <div className="w-full max-w-7xl px-6 lg:px-8 pt-24 pb-12 mx-auto space-y-8 animate-in fade-in duration-200">
      <div>
        <h2 className="text-2xl font-bold text-neutral-100 flex items-center gap-2.5">
          <BarChart3 className="h-7 w-7 text-blue-500" />
          Metrics Inspector
        </h2>
        <p className="text-sm text-neutral-400 mt-1.5">
          Cluster-wide resource utilization, CPU mcore telemetry, and RAM pressure analysis
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* CPU Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-6 space-y-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Cpu className="h-6 w-6 text-blue-400" />
              <h3 className="text-base font-semibold text-neutral-200">Aggregate CPU Usage</h3>
            </div>
            <span className="font-mono text-base text-blue-400 font-bold">1.42 / 4.0 Cores (35.5%)</span>
          </div>

          <div className="h-52 w-full rounded-xl bg-neutral-950 p-4 border border-neutral-800 flex items-end gap-2.5">
            {[40, 55, 30, 65, 80, 45, 35, 50, 60, 42, 38, 52, 70, 48, 35.5].map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div
                  className="w-full rounded-t bg-blue-500/80 group-hover:bg-blue-400 transition-all"
                  style={{ height: `${val}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Memory Telemetry Card */}
        <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-6 space-y-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <HardDrive className="h-6 w-6 text-emerald-400" />
              <h3 className="text-base font-semibold text-neutral-200">RAM Consumption</h3>
            </div>
            <span className="font-mono text-base text-emerald-400 font-bold">4.8 GB / 8.0 GB (60%)</span>
          </div>

          <div className="h-52 w-full rounded-xl bg-neutral-950 p-4 border border-neutral-800 flex items-end gap-2.5">
            {[50, 52, 55, 58, 62, 60, 61, 63, 60, 59, 62, 64, 60, 58, 60].map((val, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div
                  className="w-full rounded-t bg-emerald-500/80 group-hover:bg-emerald-400 transition-all"
                  style={{ height: `${val}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-800 bg-[#141417] p-5 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400" />
          Top Resource Consuming Pods
        </h3>
        <div className="space-y-2 font-mono text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
            <span className="text-neutral-200 font-medium">auth-service-5d6c8b-p9x1</span>
            <span className="text-blue-400">420 mcores</span>
            <span className="text-emerald-400">312 MiB</span>
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
            <span className="text-neutral-200 font-medium">postgres-db-0</span>
            <span className="text-blue-400">380 mcores</span>
            <span className="text-emerald-400">1024 MiB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
