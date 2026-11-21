import { useState } from "react";
import { ShieldAlert, Copy, Check, ArrowLeft, Building2 } from "lucide-react";
import { ErrorLayout } from "./ErrorLayout";
import { useErrorStore } from "../../store/useErrorStore";
import { Button } from "../ui/button";
import { toast } from "@/lib/toast";

interface Error403Props {
  requiredRole?: string;
  currentRole?: string;
  targetWorkspace?: string;
  isModal?: boolean;
  onDismiss?: () => void;
  onReturnToTopology?: () => void;
}

export function Error403Forbidden({
  requiredRole = "ADMIN",
  currentRole = "VIEWER",
  targetWorkspace,
  isModal = false,
  onDismiss,
  onReturnToTopology,
}: Error403Props) {
  const [copied, setCopied] = useState(false);
  const clearError = useErrorStore((s) => s.clearError);

  const handleCopyRequest = () => {
    const text = `Hi Admin, I need ${requiredRole} access on workspace "${targetWorkspace || "EnvScale"}" to perform cluster management operations.`;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Access request text copied to clipboard!");
    setTimeout(() => setCopied(false), 2500);
  };


  const handleReturn = () => {
    clearError();
    if (onDismiss) onDismiss();
    if (onReturnToTopology) onReturnToTopology();
  };

  const content = (
    <div className="space-y-4">
      {/* RBAC Role Comparison Badges */}
      <div className="flex items-center justify-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">Your Role</div>
          <span className="inline-block mt-0.5 rounded-full border border-neutral-700 bg-neutral-800 px-2.5 py-0.5 text-xs font-semibold text-neutral-200">
            {currentRole}
          </span>
        </div>
        <div className="text-neutral-600 font-mono">→</div>
        <div className="text-center">
          <div className="text-[11px] uppercase tracking-wider text-red-400">Required</div>
          <span className="inline-block mt-0.5 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-xs font-semibold text-red-300">
            {requiredRole}
          </span>
        </div>
      </div>

      {targetWorkspace && (
        <div className="flex items-center justify-center gap-2 text-xs text-neutral-400">
          <Building2 className="h-3.5 w-3.5 text-neutral-500" />
          <span>Workspace: <strong className="text-neutral-200">{targetWorkspace}</strong></span>
        </div>
      )}
    </div>
  );

  const actions = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={handleCopyRequest}
        className="flex-1 min-w-[150px] border-neutral-700 bg-neutral-800/80 text-neutral-200 hover:bg-neutral-800"
      >
        {copied ? (
          <>
            <Check className="mr-2 h-4 w-4 text-emerald-400" />
            Copied Request
          </>
        ) : (
          <>
            <Copy className="mr-2 h-4 w-4" />
            Request Role Upgrade
          </>
        )}
      </Button>

      <Button
        type="button"
        onClick={handleReturn}
        className="flex-1 min-w-[150px] bg-red-600 text-white font-medium hover:bg-red-500"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Return to Canvas
      </Button>
    </>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in">
        <div className="relative w-full max-w-md rounded-2xl border border-red-500/30 bg-[#191B20] p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-400 mb-4">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-bold text-neutral-100">Access Restricted (403)</h2>
          <p className="mt-1 text-sm text-neutral-400">
            You do not have permission to perform this action. Elevated privileges are required.
          </p>
          <div className="my-5">{content}</div>
          <div className="flex flex-wrap gap-2 justify-center">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <ErrorLayout
      statusCode={403}
      badgeText="Forbidden"
      title="Access Restricted (RBAC)"
      description="You do not possess the required RBAC role to perform operations on this resource. Your current session remains active, but this view is protected."
      icon={<ShieldAlert className="h-8 w-8 text-red-400" />}
      accentColor="red"
      actions={actions}
    >
      {content}
    </ErrorLayout>
  );
}
