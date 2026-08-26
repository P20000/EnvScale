import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiClose,
  mdiShieldCheck,
  mdiCheckCircle,
  mdiAlertCircle,
  mdiLoading,
} from "@mdi/js";
import { apiConnectCluster } from "../../config/api";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

interface ConnectClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClusterConnected: (clusterName: string) => void;
}

export function ConnectClusterModal({
  isOpen,
  onClose,
  onClusterConnected,
}: ConnectClusterModalProps) {
  const [clusterName, setClusterName] = useState("");
  const [environment, setEnvironment] = useState("development");
  const [kubeconfig, setKubeconfig] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clusterName.trim()) {
      setError("Cluster identifier is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMsg("");

    const res = await apiConnectCluster({
      name: clusterName.trim(),
      environment,
      kubeconfig,
    });

    setIsSubmitting(false);

    if (res.error) {
      setError(res.error);
    } else {
      const nameToConnect = res.cluster?.name || clusterName.trim();
      setSuccessMsg(`Cluster "${nameToConnect}" successfully connected and encrypted (AES-256-GCM).`);
      onClusterConnected(nameToConnect);
      setTimeout(() => {
        setClusterName("");
        setKubeconfig("");
        setSuccessMsg("");
        setError(null);
        onClose();
      }, 1000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-lg rounded-3xl border border-neutral-800 bg-surface p-6">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <EnvScaleLogo className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-neutral-100 font-heading">Connect K8s Cluster</h3>
              <p className="text-xs text-neutral-400">Add a new Kubernetes cluster to EnvScale</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <Icon path={mdiClose} size={0.7} />
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400 flex items-center gap-2">
            <Icon path={mdiAlertCircle} size={0.65} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg ? (
          <div className="my-6 flex flex-col items-center justify-center gap-3 py-6 text-center">
            <Icon path={mdiCheckCircle} size={2} className="text-emerald-400" />
            <p className="text-sm font-medium text-emerald-400 font-mono">{successMsg}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5 font-heading">
                Cluster Identifier / Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. minikube-prod, eks-[#01-us-east]"
                value={clusterName}
                onChange={(e) => setClusterName(e.target.value)}
                className="w-full rounded-sm border border-neutral-800 bg-background px-3.5 py-2 text-xs font-mono text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5 font-heading">
                Environment
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-sm border border-neutral-800 bg-background px-3.5 py-2 text-xs text-neutral-100 focus:border-blue-500 focus:outline-none transition-colors cursor-pointer font-mono"
              >
                <option value="development">Development (Minikube / Kind)</option>
                <option value="staging">Staging</option>
                <option value="production">Production (AWS EKS)</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-neutral-300 font-heading">
                  Kubeconfig Payload / Secret
                </label>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                  <Icon path={mdiShieldCheck} size={0.55} /> AES-256 Encrypted
                </span>
              </div>
              <textarea
                rows={4}
                placeholder="apiVersion: v1&#10;clusters: ...&#10;users: ..."
                value={kubeconfig}
                onChange={(e) => setKubeconfig(e.target.value)}
                className="w-full font-mono text-xs rounded-sm border border-neutral-800 bg-background px-3 py-2 text-neutral-200 placeholder-neutral-600 focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !clusterName.trim()}
                className="flex items-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {isSubmitting && <Icon path={mdiLoading} size={0.65} className="animate-spin" />}
                <span>{isSubmitting ? "Connecting..." : "Connect Cluster"}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

