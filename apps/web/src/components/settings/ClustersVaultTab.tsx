import { Icon } from "../ui/Icon";
import {
  mdiServerNetwork,
  mdiLock,
  mdiTrashCanOutline,
  mdiCheck,
  mdiPlus,
} from "@mdi/js";
import { useTopologyStore } from "../../store/useTopologyStore";
import { toast } from "../../lib/toast";

interface ClustersVaultTabProps {
  onOpenConnectModal: () => void;
}

export function ClustersVaultTab({ onOpenConnectModal }: ClustersVaultTabProps) {
  const clusters = useTopologyStore((s) => s.clusters);
  const activeCluster = useTopologyStore((s) => s.activeCluster);
  const setActiveCluster = useTopologyStore((s) => s.setActiveCluster);
  const deleteCluster = useTopologyStore((s) => s.deleteCluster);
  const wsStatus = useTopologyStore((s) => s.wsStatus);
  const wsLatencyMs = useTopologyStore((s) => s.wsLatencyMs);

  const handleDelete = (clusterId: string, name: string) => {
    if (clusters.length <= 1) {
      toast.warning("Cannot Delete", "At least one cluster configuration must remain active.");
      return;
    }
    if (window.confirm(`Are you sure you want to disconnect and delete cluster "${name}"?`)) {
      deleteCluster(clusterId);
      toast.success("Cluster Disconnected", `Cluster "${name}" credentials removed from workspace.`);
    }
  };

  return (
    <div className="space-y-6">
      {/* AES-256 Vault Status Banner */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Icon path={mdiLock} size={0.83} className="text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">AES-256-GCM Kubeconfig Secrets Vault</h3>
              <p className="text-[11px] text-neutral-400">
                All cluster certificates and client tokens are authenticated and encrypted using AES-256-GCM.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/20 font-mono">
            VAULT ACTIVE
          </span>
        </div>
      </div>

      {/* Connected Clusters Management List */}
      <div className="rounded-2xl border border-neutral-800 bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon path={mdiServerNetwork} size={0.83} className="text-blue-400" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-200 font-heading">Registered Kubernetes Clusters</h3>
              <p className="text-[11px] text-neutral-400">
                Active control plane endpoints and Informer state streams
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenConnectModal}
            className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <Icon path={mdiPlus} size={0.65} />
            <span>Connect Cluster</span>
          </button>
        </div>

        <div className="space-y-3 font-mono text-xs">
          {clusters.length === 0 ? (
            <div className="p-6 text-center text-neutral-500 text-xs rounded-md bg-background border border-neutral-800">
              No Kubernetes clusters currently registered. Click &quot;Connect Cluster&quot; to import a kubeconfig.
            </div>
          ) : (
            clusters.map((c) => {
              const isActive = c.id === activeCluster;
              return (
                <div
                  key={c.id}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                    isActive
                      ? "bg-blue-500/5 border-blue-500/30"
                      : "bg-background border-neutral-800"
                  }`}
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-neutral-100 font-sans text-sm">{c.name}</span>
                      {isActive && (
                        <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold text-blue-400 border border-blue-500/30">
                          Active Target
                        </span>
                      )}
                      <span className="rounded bg-neutral-800/80 px-2 py-0.5 text-[10px] text-neutral-400 border border-neutral-700/50">
                        AES-256 Encrypted
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-neutral-400">
                      <span>ID: <span className="text-neutral-300">{c.id}</span></span>
                      {isActive && (
                        <span>
                          Stream:{" "}
                          <span className={wsStatus === "CONNECTED" ? "text-emerald-400" : "text-amber-400"}>
                            {wsStatus} ({wsLatencyMs}ms)
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveCluster(c.id);
                          toast.success("Switched Cluster", `Active cluster changed to "${c.name}".`);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-neutral-800 text-neutral-300 hover:text-white text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      >
                        <Icon path={mdiCheck} size={0.55} />
                        <span>Select</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id, c.name)}
                      className="p-2 rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      title="Disconnect Cluster"
                    >
                      <Icon path={mdiTrashCanOutline} size={0.65} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
