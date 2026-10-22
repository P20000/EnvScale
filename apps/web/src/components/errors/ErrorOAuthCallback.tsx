import { Link2Off, RotateCcw, Home } from "lucide-react";
import { ErrorLayout } from "./ErrorLayout";
import { useErrorStore } from "../../store/useErrorStore";
import { useAuthStore } from "../../store/useAuthStore";
import { Button } from "../ui/button";

interface ErrorOAuthProps {
  errorReason?: string;
  onReturnToLogin?: () => void;
  onGoHome?: () => void;
}

export function ErrorOAuthCallback({
  errorReason,
  onReturnToLogin,
  onGoHome,
}: ErrorOAuthProps) {
  const clearError = useErrorStore((s) => s.clearError);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);

  const handleReturnToLogin = () => {
    clearError();
    // Sanitize any dangling URL params
    if (typeof window !== "undefined") {
      window.history.replaceState({}, document.title, window.location.pathname);
      sessionStorage.removeItem("envscale_pending_oauth");
    }

    if (onReturnToLogin) {
      onReturnToLogin();
    } else {
      openAuthModal("Authentication interrupted. Please select an account or provider.");
    }
  };

  const handleHome = () => {
    clearError();
    if (typeof window !== "undefined") {
      window.history.replaceState({}, document.title, "/");
    }
    if (onGoHome) onGoHome();
  };

  return (
    <ErrorLayout
      statusCode={302}
      badgeText="Redirect Desync"
      title="Authentication Flow Interrupted"
      description="The third-party authentication handshake (Google/GitHub) timed out, was canceled, or encountered a redirection loop."
      icon={<Link2Off className="h-8 w-8 text-purple-400" />}
      accentColor="purple"
      actions={
        <>
          <Button
            type="button"
            onClick={handleReturnToLogin}
            className="flex-1 min-w-[140px] bg-purple-600 text-white font-medium hover:bg-purple-500"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Try Sign In Again
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleHome}
            className="border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-800"
          >
            <Home className="mr-2 h-4 w-4" />
            Return to Home
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-purple-500/20 bg-neutral-900/60 p-3 text-xs text-neutral-300">
        <p className="text-neutral-400 font-medium mb-1">Callback Status Message:</p>
        <p className="font-mono text-purple-300">
          {errorReason || "OAuth state verification failed or authorization request canceled by user."}
        </p>
      </div>
    </ErrorLayout>
  );
}
