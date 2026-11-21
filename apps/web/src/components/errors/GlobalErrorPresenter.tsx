import { useErrorStore } from "../../store/useErrorStore";
import { Error401SessionExpired } from "./Error401SessionExpired";
import { Error403Forbidden } from "./Error403Forbidden";
import { Error404NotFound } from "./Error404NotFound";
import { Error429RateLimited } from "./Error429RateLimited";
import { Error500ServerCrash } from "./Error500ServerCrash";
import { Error503ServiceOffline } from "./Error503ServiceOffline";
import { ErrorOAuthCallback } from "./ErrorOAuthCallback";

interface GlobalErrorPresenterProps {
  onOpenConnectModal?: () => void;
  onReturnToTopology?: () => void;
}

export function GlobalErrorPresenter({
  onOpenConnectModal,
  onReturnToTopology,
}: GlobalErrorPresenterProps) {
  const activeError = useErrorStore((s) => s.activeError);
  const rateLimitSeconds = useErrorStore((s) => s.rateLimitSeconds);

  return (
    <>
      {/* 429 Floating Banner (shows on top of current view) */}
      {rateLimitSeconds !== null && <Error429RateLimited />}

      {/* Primary Error Dispatcher */}
      {activeError && (
        <>
          {activeError.status === 401 && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <Error401SessionExpired />
            </div>
          )}

          {activeError.status === 403 && (
            <Error403Forbidden
              isModal={activeError.variant === "modal"}
              requiredRole={activeError.requiredRole}
              currentRole={activeError.currentRole}
              targetWorkspace={activeError.targetWorkspace}
              onReturnToTopology={onReturnToTopology}
            />
          )}

          {activeError.status === 404 && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <Error404NotFound
                resourceName={activeError.details}
                onOpenConnectModal={onOpenConnectModal}
                onReturnToTopology={onReturnToTopology}
              />
            </div>
          )}

          {activeError.status === 500 && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <Error500ServerCrash
                errorId={activeError.id}
                endpoint={activeError.endpoint}
                errorMessage={activeError.details || activeError.message}
                retryAction={activeError.retryAction}
              />
            </div>
          )}

          {(activeError.status === 502 || activeError.status === 503 || activeError.status === 504) && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <Error503ServiceOffline
                statusCode={activeError.status}
                onRetry={activeError.retryAction}
              />
            </div>
          )}

          {(activeError.status === 300 || activeError.status === 302 || activeError.status === 307) && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <ErrorOAuthCallback
                errorReason={activeError.details || activeError.message}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
