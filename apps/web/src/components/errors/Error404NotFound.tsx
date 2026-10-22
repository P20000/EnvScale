import { Compass, Plus, ArrowLeft } from "lucide-react";
import { ErrorLayout } from "./ErrorLayout";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useErrorStore } from "../../store/useErrorStore";
import { Button } from "../ui/button";

interface Error404Props {
  resourceName?: string;
  onOpenConnectModal?: () => void;
  onReturnToTopology?: () => void;
}

export function Error404NotFound({
  resourceName,
  onOpenConnectModal,
  onReturnToTopology,
}: Error404Props) {
  const clusters = useTopologyStore((s) => s.clusters);
  const setActiveCluster = useTopologyStore((s) => s.setActiveCluster);
  const clearError = useErrorStore((s) => s.clearError);

  const handleSwitchToFirstCluster = () => {
    clearError();
    if (clusters.length > 0) {
      setActiveCluster(clusters[0].id);
    }
    if (onReturnToTopology) onReturnToTopology();
  };

  const handleConnect = () => {
    clearError();
    if (onOpenConnectModal) onOpenConnectModal();
  };

  return (
    <ErrorLayout
      statusCode={404}
      badgeText="Not Found"
      title={resourceName ? `"${resourceName}" Not Found` : "Resource Not Found"}
      description="The Kubernetes cluster, workload, or workspace route you requested does not exist or may have been deleted."
      icon={<Compass className="h-8 w-8 text-blue-400" />}
      accentColor="blue"
      actions={
        <>
          {clusters.length > 0 ? (
            <Button
              type="button"
              onClick={handleSwitchToFirstCluster}
              className="flex-1 min-w-[140px] bg-blue-600 text-white font-medium hover:bg-blue-500"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Switch to {clusters[0].name || "First Cluster"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleConnect}
              className="flex-1 min-w-[140px] bg-blue-600 text-white font-medium hover:bg-blue-500"
            >
              <Plus className="mr-2 h-4 w-4" />
              Connect Cluster
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearError();
              if (onReturnToTopology) onReturnToTopology();
            }}
            className="border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-800"
          >
            Return to Overview
          </Button>
        </>
      }
    >
      {clusters.length > 1 && (
        <div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
            Available Clusters in Workspace
          </p>
          <div className="flex flex-wrap gap-2">
            {clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  clearError();
                  setActiveCluster(c.id);
                  if (onReturnToTopology) onReturnToTopology();
                }}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-300"
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </ErrorLayout>
  );
}
