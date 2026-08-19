import { useState, type ChangeEvent, type DragEvent } from "react";
import { Button } from "../ui/button";

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
  const handleConnect = () => {
  if (!kubeconfigFile || !clusterName.trim()) {
    return;
  }

  setIsConnecting(true);
  setConnectionError("");

  setTimeout(() => {
    setIsConnecting(false);
    setIsConnected(true);
  }, 1500);
};
  if (isConnected) {
    if (connectionError) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 text-white shadow-2xl sm:p-6">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 text-white shadow-2xl sm:p-6">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-3xl text-emerald-400">
          ✓
        </div>

        <h2 className="mt-4 text-2xl font-semibold">
          Cluster Connected!
        </h2>

        <p className="mt-2 text-sm text-slate-400">
          {clusterName} has been connected successfully.
        </p>

        <Button
          className="mt-6"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
        <div className="mb-6 flex items-start gap-4">
          <div>
            <p className="text-sm text-cyan-400">
              Step {step} of 3
            </p>

            <h2 className="mt-1 text-2xl font-semibold">
              Connect Cluster
            </h2>

            <p className="mt-1 max-w-full break-words text-sm leading-5 text-slate-400">
  Connect your Kubernetes cluster to EnvScale.
</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 text-xl text-slate-400 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="cluster-name"
                className="mb-2 block text-sm font-medium"
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
  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
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
              <p className="mb-2 text-sm font-medium">
                Kubeconfig File
              </p>

              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? "border-cyan-400 bg-cyan-400/10"
                    : "border-slate-700 bg-slate-800"
                }`}
              >
                <p className="text-slate-300">
                  Drag & drop your kubeconfig here
                </p>

                <p className="my-2 text-sm text-slate-500">
  or
</p>

<p className="mb-3 text-xs text-slate-500">
  YAML files only (.yaml, .yml)
</p>
                <label className="inline-flex cursor-pointer rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400">
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
    <p className="text-sm text-emerald-400">
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
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
              <p className="text-sm text-slate-400">
                Cluster
              </p>

              <p className="font-medium">
                {clusterName}
              </p>
            </div>

            <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
              <p className="text-sm text-slate-400">
                Kubeconfig
              </p>

              <p className="font-medium">
                {kubeconfigFile?.name}
              </p>
            </div>

            <p className="text-sm text-slate-400">
              Review the details above and connect your
              Kubernetes cluster.
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
