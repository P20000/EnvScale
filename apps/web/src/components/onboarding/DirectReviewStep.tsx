import { useState } from "react";
import { Icon } from "../ui/Icon";
import { mdiCheck, mdiAlertCircle } from "@mdi/js";

interface DirectReviewStepProps {
  clusterName: string;
  environment: string;
  kubeconfigFile: File | null;
  connectionError: string;
  formattedError: { friendly: string; details: string } | null;
}

export function DirectReviewStep({
  clusterName,
  environment,
  kubeconfigFile,
  formattedError,
}: DirectReviewStepProps) {
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#30343B] bg-[#111318] p-3 text-[#E6E1E5] font-mono text-xs">
        <p className="mb-1 text-[#92959D]">Cluster Name</p>
        <p className="font-semibold text-[#E6E1E5]">{clusterName}</p>
      </div>

      <div className="rounded-xl border border-[#30343B] bg-[#111318] p-3 text-[#E6E1E5] font-mono text-xs">
        <p className="mb-1 text-[#92959D]">Environment</p>
        <p className="font-semibold text-[#E6E1E5] capitalize">{environment}</p>
      </div>

      <div className="rounded-xl border border-[#30343B] bg-[#111318] p-3 text-[#E6E1E5] font-mono text-xs">
        <p className="mb-1 text-[#92959D]">Kubeconfig Payload</p>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-[#E6E1E5]">{kubeconfigFile?.name}</p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded bg-[#6DD6A8]/10 px-3 py-2 text-[#6DD6A8] border border-[#6DD6A8]/20">
          <Icon path={mdiCheck} size={0.7} />
          <span className="text-xs font-medium">Kubeconfig securely loaded in memory</span>
        </div>
      </div>

      {formattedError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="flex items-start gap-2.5">
            <Icon path={mdiAlertCircle} size={0.7} className="mt-0.5 shrink-0 text-red-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-300">Connection Failed</p>
              <p className="mt-1 text-xs text-red-400/80 leading-relaxed">{formattedError.friendly}</p>
              {formattedError.details && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowErrorDetails(!showErrorDetails)}
                    className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-400 underline underline-offset-2 transition-colors"
                  >
                    {showErrorDetails ? "Hide" : "Show"} Technical Details
                  </button>
                  {showErrorDetails && (
                    <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-black/40 p-2 text-[10px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-all">
                      {formattedError.details}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
