import { useState } from "react";
import { X, Layers, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { apiCreateWorkspace } from "../../config/api";

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceCreated?: (name: string) => void;
}

export function WorkspaceModal({ isOpen, onClose, onWorkspaceCreated }: WorkspaceModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Workspace name is required.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const result = await apiCreateWorkspace({ name, description });
    setIsLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccessMsg("Workspace created successfully!");
      setTimeout(() => {
        onWorkspaceCreated?.(name);
        onClose();
        setName("");
        setDescription("");
        setSuccessMsg(null);
      }, 800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-[#141417] p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-100">Create New Workspace</h3>
              <p className="text-xs text-neutral-400">Provision a multi-tenant Kubernetes environment</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300">Workspace Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Payments Engineering"
              required
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300">Description (Optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Multi-tenant production & staging microservices workspace"
              rows={3}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-xs text-neutral-100 placeholder-neutral-500 focus:border-purple-500 focus:outline-none transition-colors resize-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{isLoading ? "Creating..." : "Create Workspace"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
