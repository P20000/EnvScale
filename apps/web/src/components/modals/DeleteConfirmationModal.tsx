import { memo } from "react";
import {
  MdClose as X,
  MdWarning as AlertTriangle,
  MdRefresh as RotateCcw,
  MdDeleteForever as Trash,
} from "react-icons/md";
import { useTopologyStore } from "../../store/useTopologyStore";

export interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetId: string;
  targetName: string;
  targetKind: string;
  namespace?: string;
}

export const DeleteConfirmationModal = memo(
  ({
    isOpen,
    onClose,
    targetId,
    targetName,
    targetKind,
    namespace = "default",
  }: DeleteConfirmationModalProps) => {
    const removeTarget = useTopologyStore((s) => s.removeTarget);

    if (!isOpen) return null;

    const isPod = targetKind.toLowerCase().includes("pod");

    // Extract parent controller name (e.g., worker-pool-5f8d4dcdd8-226vq -> worker-pool)
    const deriveParentWorkloadName = (podName: string) => {
      const parts = podName.split("-");
      if (parts.length >= 3) {
        return parts.slice(0, -2).join("-");
      }
      return podName;
    };

    const parentWorkloadName = deriveParentWorkloadName(targetName);

    const handlePodRestart = () => {
      removeTarget(targetId);
      onClose();
    };

    const handleDeleteParentWorkload = () => {
      // Delete parent workload deployment
      removeTarget(parentWorkloadName);
      removeTarget(targetId);
      onClose();
    };

    const handleStandardDelete = () => {
      removeTarget(targetId);
      onClose();
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-[#141417] p-6 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-neutral-400 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex items-center gap-3 border-b border-neutral-800 pb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-100">
                Confirm Deletion Intent
              </h3>
              <p className="text-xs text-neutral-400">
                Namespace: <span className="font-mono text-neutral-200">{namespace}</span>
              </p>
            </div>
          </div>

          <div className="py-4 space-y-3">
            {isPod ? (
              <>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Pod <span className="font-mono font-bold text-neutral-100">{targetName}</span> is managed by a Kubernetes Deployment controller (<span className="font-mono text-blue-400">{parentWorkloadName}</span>).
                </p>
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-300 leading-normal">
                  ⚠️ Deleting an individual managed Pod only restarts it. To permanently remove the workload from Kubernetes, delete the parent Deployment.
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={handlePodRestart}
                    className="w-full flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs font-medium text-neutral-200 hover:border-amber-500/50 hover:bg-amber-500/10 hover:text-amber-300 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-amber-400 shrink-0" />
                      <div className="text-left">
                        <div className="font-semibold">Restart Pod Only</div>
                        <div className="text-[10px] text-neutral-400">Triggers K8s pod reschedule</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={handleDeleteParentWorkload}
                    className="w-full flex items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs font-medium text-red-300 hover:bg-red-500/20 hover:border-red-500 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Trash className="h-4 w-4 text-red-400 shrink-0" />
                      <div className="text-left">
                        <div className="font-semibold">Delete Entire Workload ({parentWorkloadName})</div>
                        <div className="text-[10px] text-red-300/80">Permanently stops all replicas in cluster</div>
                      </div>
                    </div>
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Are you sure you want to physically delete <span className="font-semibold text-neutral-100">{targetKind}</span> <span className="font-mono font-bold text-neutral-100">{targetName}</span> from the live Kubernetes cluster?
                </p>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-800">
                  <button
                    onClick={onClose}
                    className="rounded-lg bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStandardDelete}
                    className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition-colors cursor-pointer shadow-lg shadow-red-600/20"
                  >
                    Delete Resource
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);

DeleteConfirmationModal.displayName = "DeleteConfirmationModal";
