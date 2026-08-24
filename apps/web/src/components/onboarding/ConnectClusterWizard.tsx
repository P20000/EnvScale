import { useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "../ui/Icon";
import { mdiCheckCircle, mdiClose, mdiUpload } from "@mdi/js";
import { Button } from "../ui/button";
import { apiConnectCluster } from "../../config/api";

type ConnectClusterWizardProps = {
  onClose: () => void;
  onClusterConnected?: (clusterName: string) => void;
};

export default function ConnectClusterWizard({
  onClose,
  onClusterConnected,
}: ConnectClusterWizardProps) {
  const [step, setStep] = useState(1);
  const [clusterName, setClusterName] = useState("");
  const [kubeconfigFile, setKubeconfigFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const [clusterError, setClusterError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const handleFile = (file: File | undefined) => {
  if (!file) return;

  const fileName = file.name.toLowerCase();

  const isValidFile =
    fileName.endsWith(".yaml") ||
    fileName.endsWith(".yml");

  if (!isValidFile) {
    setKubeconfigFile(null);
    setFileError(
      "Please upload a YAML kubeconfig file (.yaml or .yml)."
    );
    return;
  }

  setFileError("");
  setKubeconfigFile(file);
};

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    handleFile(event.dataTransfer.files?.[0]);
  };

   const nextStep = () => {
  if (step === 1 && !clusterName.trim()) {
    setClusterError("Cluster name is required.");
    return;
  }

  if (step === 1) {
    setClusterError("");
  }

  if (step === 2 && !kubeconfigFile) {
    setFileError("Please upload a kubeconfig file.");
    return;
  }

  if (step === 2) {
    setFileError("");
  }

  setStep((currentStep) => currentStep + 1);
};
  const previousStep = () => {
    setStep((currentStep) => currentStep - 1);
  };
  const handleConnect = async () => {
    if (!kubeconfigFile || !clusterName.trim()) {
      return;
    }

    setIsConnecting(true);
    setConnectionError("");

    try {
      const kubeconfigText = await kubeconfigFile.text();
      const res = await apiConnectCluster({
        name: clusterName.trim(),
        environment: "development",
        kubeconfig: kubeconfigText,
      });

      setIsConnecting(false);

      if (res.error) {
        setConnectionError(res.error);
        setIsConnected(true);
      } else {
        setIsConnected(true);
      }
    } catch (err) {
      setIsConnecting(false);
      setConnectionError(err instanceof Error ? err.message : "Failed to read Kubeconfig file");
      setIsConnected(true);
    }
  };
  if (isConnected) {
    if (connectionError) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-[#141417] shadow-none p-4 text-white sm:p-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-3xl text-red-400">
          ×
        </div>

        <h2 className="mt-4 text-2xl font-semibold">
          Connection Failed
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          {connectionError}
        </p>

        <div className="mt-6 flex justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => setConnectionError("")}
          >
            Back
          </Button>

          <Button
            onClick={handleConnect}
          >
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
}
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
          {clusterName} has been connected successfully.
        </p>

        <Button
          className="mt-6 w-full"
          onClick={() => {
            onClusterConnected?.(clusterName);
            onClose();
          }}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-[#141417] shadow-none p-6 text-white">
        <div className="mb-6 flex items-start gap-4">
          <div>
            <p className="text-sm text-blue-400 font-mono">
              Step {step} of 3
            </p>

            <h2 className="mt-1 text-2xl font-semibold font-heading">
              Connect Cluster
            </h2>

            <p className="mt-1 max-w-full break-words text-sm leading-5 text-neutral-400">
              Connect your Kubernetes cluster to EnvScale.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 p-1 text-neutral-400 hover:text-white rounded-md transition-colors"
            aria-label="Close"
          >
            <Icon path={mdiClose} size={0.8} />
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="cluster-name"
                className="mb-2 block text-sm font-medium text-neutral-200"
              >
                Cluster Name
              </label>

              <input
                id="cluster-name"
                type="text"
                value={clusterName}
                onChange={(event) => {
                  setClusterName(event.target.value);

                  if (event.target.value.trim()) {
                    setClusterError("");
                  }
                }}
                placeholder="e.g. production-cluster"
                className="w-full bg-[#09090b] border border-zinc-800 text-xs font-mono py-2 px-3 focus:border-zinc-600 focus:outline-none rounded-md text-white placeholder:text-neutral-500"
              />

              {clusterError && (
                <p className="mt-2 text-sm text-red-400">
                  {clusterError}
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-neutral-200">
                Kubeconfig File
              </p>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`rounded-xl border border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-zinc-800 bg-[#09090b]"
                }`}
              >
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Icon path={mdiUpload} size={0.83} />
                </div>
                <p className="text-neutral-300 text-sm">
                  Drag & drop your kubeconfig here
                </p>

                <p className="my-1.5 text-xs text-neutral-500">
                  or
                </p>

                <p className="mb-3 text-xs text-neutral-500">
                  YAML files only (.yaml, .yml)
                </p>
                <label className="inline-flex cursor-pointer rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors">
                  Browse File

                  <input
                    type="file"
                    accept=".yaml,.yml"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>

                {kubeconfigFile && (
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <p className="text-sm text-emerald-400 font-mono">
                      Selected: {kubeconfigFile.name}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        setKubeconfigFile(null);
                        setFileError("");
                      }}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                )}
                {fileError && (
                  <p className="mt-4 text-sm text-red-400">
                    {fileError}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-zinc-300 font-mono text-xs">
              <p className="mb-1 text-zinc-500">
                Cluster Name
              </p>
              <p className="font-semibold text-zinc-200">
                {clusterName}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-zinc-300 font-mono text-xs">
              <p className="mb-1 text-zinc-500">
                Kubeconfig Payload
              </p>
              <p className="font-semibold text-zinc-200">
                {kubeconfigFile?.name}
              </p>
            </div>

            <p className="text-sm text-neutral-400">
              Review the details above and connect your Kubernetes cluster.
            </p>
          </div>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : previousStep}
          >
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step < 3 ? (
            <Button onClick={nextStep}>
              Next
            </Button>
          ) : (
            <Button
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect Cluster"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
