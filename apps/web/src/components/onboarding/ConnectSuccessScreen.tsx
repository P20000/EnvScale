import { Icon } from "../ui/Icon";
import { mdiCheckCircle } from "@mdi/js";
import { Button } from "../ui/button";
import type { Cluster } from "../../store/types/topologyTypes";

type ConnectSuccessScreenProps = {
  connectedCluster: { id: string; name: string };
  onClose: () => void;
  onClusterConnected?: (cluster: Cluster) => void;
};

export function ConnectSuccessScreen({
  connectedCluster,
  onClose,
  onClusterConnected,
}: ConnectSuccessScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-[#141417] shadow-none p-4 text-white sm:p-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Icon path={mdiCheckCircle} size={1.2} />
        </div>

        <h2 className="mt-4 text-2xl font-semibold font-heading text-center">
          Cluster Connected!
        </h2>

        <p className="mt-2 text-sm text-neutral-400 text-center">
          {connectedCluster.name} has been connected successfully.
        </p>

        <Button
          className="mt-6 w-full"
          onClick={() => {
            // we safely cast this object to Cluster since onClusterConnected only requires an object
            onClusterConnected?.(connectedCluster as Cluster);
            onClose();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
