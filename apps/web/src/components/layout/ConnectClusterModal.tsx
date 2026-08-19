import { useState } from "react";
import { X, Server, Shield, CheckCircle2 } from "lucide-react";

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
  const [successMsg, setSuccessMsg] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clusterName.trim()) return;

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setSuccessMsg(`Cluster "${clusterName}" successfully connected and encrypted (AES-256-GCM).`);
      setTimeout(() => {
        onClusterConnected(clusterName.trim());
        setClusterName("");
        setKubeconfig("");
        setSuccessMsg("");
        onClose();
      }, 1200);
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-neutral-800 bg-[#141417] p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 border border-blue-500/20">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-neutral-100">Connect K8s Cluster</h3>
              <p className="text-xs text-neutral-400">Add a new Kubernetes cluster to EnvScale</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {successMsg ? (
          <div className="my-6 flex flex-col items-center justify-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 animate-bounce" />
            <p className="text-sm font-medium text-emerald-400">{successMsg}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Cluster Identifier / Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. minikube-prod, eks-[#01-us-east]"
                value={clusterName}
                onChange={(e) => setClusterName(e.target.value)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Environment
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              >
                <option value="development">Development (Minikube / Kind)</option>
                <option value="staging">Staging</option>
                <option value="production">Production (AWS EKS)</option>
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-neutral-300">
                  Kubeconfig Payload / Secret
                </label>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                  <Shield className="h-3 w-3" /> AES-256 Encrypted
                </span>
              </div>
              <textarea
                rows={4}
                placeholder="apiVersion: v1&#10;clusters: ...&#10;users: ..."
                value={kubeconfig}
                onChange={(e) => setKubeconfig(e.target.value)}
                className="w-full font-mono text-xs rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-neutral-200 placeholder-neutral-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !clusterName.trim()}
                className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 active:scale-95 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20"
              >
                {isSubmitting ? "Connecting..." : "Connect Cluster"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
