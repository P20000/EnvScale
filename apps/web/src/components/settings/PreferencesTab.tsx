import { Icon } from "../ui/Icon";
import {
  mdiTextBoxOutline,
  mdiEyeOffOutline,
} from "@mdi/js";
import { useUIStore } from "../../store/useUIStore";
import { toast } from "../../lib/toast";

export function PreferencesTab() {
  const logBufferLimit = useUIStore((s) => s.logBufferLimit);
  const setLogBufferLimit = useUIStore((s) => s.setLogBufferLimit);
  const showSystemNamespaces = useUIStore((s) => s.showSystemNamespaces);
  const setShowSystemNamespaces = useUIStore((s) => s.setShowSystemNamespaces);

  const handleBufferChange = (limit: number) => {
    setLogBufferLimit(limit);
    toast.success("Log Buffer Updated", `Log viewer depth set to ${limit} lines.`);
  };

  const handleNamespaceToggle = () => {
    const next = !showSystemNamespaces;
    setShowSystemNamespaces(next);
    toast.info(
      "Filter Preference Updated",
      next ? "System namespaces visible on topology canvas." : "System namespaces hidden by default."
    );
  };

  const isFilteringSystemNamespaces = !showSystemNamespaces;

  return (
    <div className="space-y-6">
      {/* Live Pod Log Depth */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon path={mdiTextBoxOutline} size={0.83} className="text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">Live Pod Log Terminal Depth</h3>
              <p className="text-[11px] text-neutral-400">
                Number of lines retained in memory during real-time streaming tailing
              </p>
            </div>
          </div>
          <span className="font-mono text-xs text-blue-400 font-semibold bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/20">
            {logBufferLimit} lines
          </span>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          {[250, 500, 1000].map((limit) => (
            <button
              key={limit}
              type="button"
              onClick={() => handleBufferChange(limit)}
              className={`px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                logBufferLimit === limit
                  ? "bg-blue-500/15 text-blue-400 border border-blue-500/40"
                  : "bg-background border border-neutral-800 text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {limit} lines
            </button>
          ))}
        </div>
      </div>

      {/* System Namespaces Filtering */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon path={mdiEyeOffOutline} size={0.83} className="text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">System Namespaces Canvas Filter</h3>
              <p className="text-[11px] text-neutral-400">
                Hide Kubernetes system namespaces (kube-system, kube-public, ingress-nginx) from visual canvas
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`text-[11px] font-mono font-medium ${isFilteringSystemNamespaces ? "text-blue-400" : "text-neutral-500"}`}>
              {isFilteringSystemNamespaces ? "Filtered (Hidden)" : "Visible"}
            </span>
            {/* Pixel-perfect Signature Blue Switch Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={isFilteringSystemNamespaces}
              aria-label="Filter system namespaces"
              onClick={handleNamespaceToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isFilteringSystemNamespaces ? "bg-blue-500" : "bg-[#30343B]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  isFilteringSystemNamespaces ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
