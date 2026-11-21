import { Lock, LogIn, UserCheck, ArrowRight } from "lucide-react";
import { ErrorLayout } from "./ErrorLayout";
import { useAuthStore } from "../../store/useAuthStore";
import { useErrorStore } from "../../store/useErrorStore";
import { Button } from "../ui/button";

interface Error401Props {
  onSignIn?: () => void;
  onContinueAsGuest?: () => void;
}

export function Error401SessionExpired({ onSignIn, onContinueAsGuest }: Error401Props) {
  const savedAccounts = useAuthStore((s) => s.savedAccounts);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
  const switchAccount = useAuthStore((s) => s.switchAccount);
  const clearError = useErrorStore((s) => s.clearError);

  const handleSignIn = () => {
    clearError();
    if (onSignIn) {
      onSignIn();
    } else {
      openAuthModal("Your session expired. Please sign in to resume your active workspace.");
    }
  };

  const handleGuest = () => {
    clearError();
    if (onContinueAsGuest) {
      onContinueAsGuest();
    }
  };

  const handleQuickSwitch = async (accountId: string) => {
    const success = await switchAccount(accountId);
    if (success) {
      clearError();
    } else {
      handleSignIn();
    }
  };

  return (
    <ErrorLayout
      statusCode={401}
      badgeText="Unauthorized"
      title="Session Expired or Revoked"
      description="Your credentials are no longer valid, or your session timed out. Please authenticate to regain access to your clusters and workspace metrics."
      icon={<Lock className="h-8 w-8 text-amber-400" />}
      accentColor="amber"
      actions={
        <>
          <Button
            type="button"
            onClick={handleSignIn}
            className="flex-1 min-w-[140px] bg-amber-500 text-neutral-950 font-semibold hover:bg-amber-400"
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign In Again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleGuest}
            className="border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-800"
          >
            Continue as Guest
          </Button>
        </>
      }
    >
      {savedAccounts && savedAccounts.length > 0 && (
        <div className="mt-2 space-y-2 rounded-xl border border-neutral-800/80 bg-neutral-900/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Previously Active Accounts
          </p>
          <div className="space-y-1.5">
            {savedAccounts.slice(0, 3).map((acc) => (
              <button
                key={acc.id}
                type="button"
                onClick={() => void handleQuickSwitch(acc.id)}
                className="group flex w-full items-center justify-between rounded-lg border border-neutral-800/60 bg-neutral-950/40 px-3 py-2 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/5"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-xs font-medium text-amber-300">
                    {acc.name ? acc.name[0].toUpperCase() : "U"}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-neutral-200 group-hover:text-amber-300">
                      {acc.name || acc.email}
                    </div>
                    <div className="text-[11px] text-neutral-500">{acc.email}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-xs text-neutral-500 group-hover:text-amber-400">
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>Resume</span>
                  <ArrowRight className="h-3 w-3" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </ErrorLayout>
  );
}
