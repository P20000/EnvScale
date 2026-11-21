import { Icon } from "../ui/Icon";
import { mdiClose, mdiLock, mdiShieldLockOutline } from "@mdi/js";
import { Button } from "../ui/button";

interface WizardAuthRequiredModalProps {
  onClose: () => void;
  onSignIn: () => void;
}

export function WizardAuthRequiredModal({ onClose, onSignIn }: WizardAuthRequiredModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-3xl border border-[#30343B] bg-[#191B20] p-6 text-[#E6E1E5] shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Icon path={mdiShieldLockOutline} size={0.8} />
            </div>
            <div>
              <h2 className="text-sm font-semibold font-heading text-neutral-100">Authentication Required</h2>
              <p className="text-xs text-neutral-400">Sign in to connect clusters</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-md transition-colors"
            aria-label="Close"
          >
            <Icon path={mdiClose} size={0.8} />
          </button>
        </div>

        <div className="my-6 space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Icon path={mdiLock} size={1.5} />
          </div>
          <h3 className="text-base font-semibold text-neutral-100 font-heading">
            Restricted Cluster Setup
          </h3>
          <p className="text-xs text-neutral-400 leading-relaxed max-w-sm mx-auto">
            Connecting a Kubernetes cluster requires an authenticated user session to securely attach telemetry streams to your workspace.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-zinc-800 text-neutral-300 hover:bg-zinc-800 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onClose();
              onSignIn();
            }}
            className="bg-blue-500 text-white hover:bg-blue-600"
          >
            Sign In to Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
