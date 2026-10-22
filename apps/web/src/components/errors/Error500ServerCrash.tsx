import { useState } from "react";
import { ServerCrash, RotateCcw, Copy, Check, RefreshCw } from "lucide-react";
import { ErrorLayout } from "./ErrorLayout";
import { useErrorStore } from "../../store/useErrorStore";
import { Button } from "../ui/button";
import { toast } from "@/lib/toast";

interface Error500Props {
  errorId?: string;
  endpoint?: string;
  errorMessage?: string;
  retryAction?: () => Promise<void> | void;
  onSafeReload?: () => void;
}

export function Error500ServerCrash({
  errorId,
  endpoint,
  errorMessage,
  retryAction,
  onSafeReload,
}: Error500Props) {
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const clearError = useErrorStore((s) => s.clearError);

  const handleRetry = async () => {
    if (retryAction) {
      setIsRetrying(true);
      try {
        await retryAction();
        clearError();
      } catch {
        toast.error("Retry failed. Server still reporting errors.");
      } finally {
        setIsRetrying(false);
      }
    } else {
      window.location.reload();
    }
  };

  const handleCopyDiagnostics = () => {
    const report = {
      timestamp: new Date().toISOString(),
      errorId: errorId || `ERR-${Date.now()}`,
      endpoint: endpoint || "unknown",
      message: errorMessage || "Unhandled exception in application engine",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "N/A",
    };

    void navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
    toast.success("Diagnostics copied to clipboard!");
    setTimeout(() => setCopied(false), 2500);
  };


  const handleSafeReload = () => {
    clearError();
    if (onSafeReload) {
      onSafeReload();
    } else {
      localStorage.removeItem("envscale-topology-storage");
      window.location.reload();
    }
  };

  return (
    <ErrorLayout
      statusCode={500}
      badgeText="Server Crash"
      title="Internal Server Error"
      description="The EnvScale server engine encountered an unhandled exception. Your session data is intact, but the requested operation failed to complete."
      icon={<ServerCrash className="h-8 w-8 text-red-400" />}
      accentColor="red"
      actions={
        <>
          <Button
            type="button"
            onClick={() => void handleRetry()}
            disabled={isRetrying}
            className="flex-1 min-w-[140px] bg-red-600 text-white font-medium hover:bg-red-500"
          >
            <RotateCcw className={`mr-2 h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "Retrying..." : "Retry Request"}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleCopyDiagnostics}
            className="border-neutral-700 bg-neutral-800/80 text-neutral-200 hover:bg-neutral-800"
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4 text-emerald-400" />
                Copied Report
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Diagnostics
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={handleSafeReload}
            className="text-neutral-400 hover:text-neutral-200"
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Safe Mode Reload
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-red-500/20 bg-neutral-900/80 p-3 font-mono text-xs text-neutral-300">
        <div className="flex justify-between text-neutral-400 border-b border-neutral-800 pb-1.5 mb-2">
          <span>Error Ref: {errorId || "ERR-CORE-500"}</span>
          <span>{endpoint ? `Route: ${endpoint}` : "API Engine"}</span>
        </div>
        <p className="line-clamp-2 text-red-300">
          {errorMessage || "Internal database or core service error."}
        </p>
      </div>
    </ErrorLayout>
  );
}
