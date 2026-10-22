import { Radio, RefreshCw, WifiOff } from "lucide-react";
import { ErrorLayout } from "./ErrorLayout";
import { useErrorStore } from "../../store/useErrorStore";
import { Button } from "../ui/button";

interface Error503Props {
  statusCode?: number;
  onRetry?: () => void;
  onWorkOffline?: () => void;
}

export function Error503ServiceOffline({
  statusCode = 503,
  onRetry,
  onWorkOffline,
}: Error503Props) {
  const healthStatus = useErrorStore((s) => s.healthStatus);
  const clearError = useErrorStore((s) => s.clearError);

  const handleManualRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    clearError();
    if (onWorkOffline) onWorkOffline();
  };

  return (
    <ErrorLayout
      statusCode={statusCode}
      badgeText={statusCode === 504 ? "Gateway Timeout" : "Service Offline"}
      title="Infrastructure Deploying or Updating"
      description="The EnvScale cloud API is momentarily unreachable or restarting. An automatic health monitoring probe is active."
      icon={<Radio className="h-8 w-8 text-cyan-400 animate-pulse" />}
      accentColor="cyan"
      actions={
        <>
          <Button
            type="button"
            onClick={handleManualRetry}
            className="flex-1 min-w-[140px] bg-cyan-600 text-white font-medium hover:bg-cyan-500"
          >
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            Check Connection Now
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleDismiss}
            className="border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-800"
          >
            <WifiOff className="mr-2 h-4 w-4" />
            Dismiss / Stay on Page
          </Button>
        </>
      }
    >
      {/* Live Auto-Recovery Radar Card */}
      <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-cyan-500" />
          </div>
          <div className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
            Automated Reconnection Probe Active
          </div>
        </div>

        <p className="mt-2 text-xs text-neutral-300 leading-relaxed">
          Pinging <code className="rounded bg-neutral-900 px-1 py-0.5 text-cyan-300 font-mono">/api/health</code>.
          As soon as the backend container initializes, this screen will automatically dismiss.
        </p>

        <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-400 border-t border-cyan-500/20 pt-2 font-mono">
          <span>Health Probe Status:</span>
          <span className="text-cyan-300">
            {healthStatus.isChecking ? `Attempt #${healthStatus.attempts || 1}` : "Standby"}
          </span>
        </div>
      </div>
    </ErrorLayout>
  );
}
