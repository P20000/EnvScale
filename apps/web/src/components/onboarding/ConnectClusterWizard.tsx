import { useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "../ui/Icon";
import { mdiClose, mdiUpload, mdiChevronDown, mdiAlertCircle, mdiCheck } from "@mdi/js";
import { Button } from "../ui/button";
import { apiConnectCluster, apiMe } from "../../config/api";
import { useTopologyStore } from "../../store/useTopologyStore";
import { connectClusterSchema, formatConnectionError } from "./wizardHelpers";
import { ConnectSuccessScreen } from "./ConnectSuccessScreen";
import type { Cluster } from "../../store/types/topologyTypes";

type ConnectClusterWizardProps = {
  onClose: () => void;
  onClusterConnected?: (cluster: Cluster) => void;
};

export default function ConnectClusterWizard({
  onClose,
  onClusterConnected,
}: ConnectClusterWizardProps) {
  const [step, setStep] = useState(1);
  const [clusterName, setClusterName] = useState("");
  const [environment, setEnvironment] = useState<"development" | "staging" | "production">("development");
  const [kubeconfigFile, setKubeconfigFile] = useState<File | null>(null);
  const [kubeconfigContent, setKubeconfigContent] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const [clusterError, setClusterError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const clusters = useTopologyStore((s) => s.clusters);
  const [connectedCluster, setConnectedCluster] = useState<{ id: string; name: string } | null>(null);

  const handleFile = (file: File | undefined) => {
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isValidFile = fileName.endsWith(".yaml") || fileName.endsWith(".yml");

    if (!isValidFile) {
      setKubeconfigFile(null);
      setFileError("Please upload a YAML kubeconfig file (.yaml or .yml).");
      return;
    }

    setFileError("");
    setKubeconfigFile(file);
    file.text().then(text => {
      setKubeconfigContent(text);
      // Optional: inline validation when loaded
      const result = connectClusterSchema.safeParse({
        name: clusterName || "temp",
        environment,
        kubeconfig: text,
      });
      if (!result.success) {
        const issues = result.error.issues;
        const kubeErr = issues.find(i => i.path[0] === "kubeconfig");
        if (kubeErr) setFileError(kubeErr.message);
      }
    }).catch(() => setKubeconfigContent(""));
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
    if (step === 1) {
      if (!clusterName.trim()) {
        setClusterError("Cluster name is required.");
        return;
      }
      if (clusters.some(c => c.name === clusterName.trim())) {
        setClusterError("A cluster with this name already exists.");
        return;
      }
      
      const res = connectClusterSchema.pick({ name: true, environment: true }).safeParse({
        name: clusterName,
        environment,
      });
      if (!res.success) {
        setClusterError(res.error.issues[0]?.message || "Invalid input");
        return;
      }
      setClusterError("");
    }

    if (step === 2) {
      if (!kubeconfigFile || !kubeconfigContent) {
        setFileError("Please upload a valid kubeconfig file.");
        return;
      }
      
      const res = connectClusterSchema.pick({ kubeconfig: true }).safeParse({
        kubeconfig: kubeconfigContent,
      });
      
      if (!res.success) {
        setFileError(res.error.issues[0]?.message || "Invalid kubeconfig");
        return;
      }
      
      setFileError("");
    }

    setStep((currentStep) => currentStep + 1);
  };

  const previousStep = () => {
    setStep((currentStep) => currentStep - 1);
  };

  const handleConnect = async () => {
    if (!kubeconfigFile || !clusterName.trim()) return;

    setIsConnecting(true);
    setConnectionError("");
    setShowErrorDetails(false);

    try {
      const parsed = connectClusterSchema.safeParse({
        name: clusterName,
        environment,
        kubeconfig: kubeconfigContent,
      });

      if (!parsed.success) {
        setConnectionError(parsed.error.issues[0]?.message || "Invalid configuration");
        setIsConnecting(false);
        return;
      }

      let workspaceId: string | undefined = undefined;
      const meData = await apiMe();
      if (meData?.workspace?.id) {
        workspaceId = meData.workspace.id;
      }

      const res = await apiConnectCluster({
        name: parsed.data.name,
        environment: parsed.data.environment,
        kubeconfig: parsed.data.kubeconfig,
        workspaceId,
      });

      setIsConnecting(false);

      if (res.error) {
        setConnectionError(res.error);
      } else {
        if (res.cluster?.id) {
           setConnectedCluster({ id: res.cluster.id, name: res.cluster.name });
        } else {
           setConnectedCluster({ id: `temp-${Date.now()}`, name: parsed.data.name });
        }
        setIsConnected(true);
      }
    } catch (err) {
      setIsConnecting(false);
      setConnectionError(err instanceof Error ? err.message : "Failed to read Kubeconfig file");
    }
  };

  if (isConnected && connectedCluster) {
    return (
      <ConnectSuccessScreen 
        connectedCluster={connectedCluster} 
        onClose={onClose} 
        onClusterConnected={onClusterConnected} 
      />
    );
  }

  const formattedError = connectionError ? formatConnectionError(connectionError) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-[#141417] shadow-none p-6 text-white">
        <div className="mb-6 flex items-start gap-4">
          <div>
            <p className="text-sm text-blue-400 font-mono">Step {step} of 3</p>
            <h2 className="mt-1 text-2xl font-semibold font-heading">Connect Cluster</h2>
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
              <label htmlFor="cluster-name" className="mb-2 block text-sm font-medium text-neutral-200">
                Cluster Name
              </label>
              <input
                id="cluster-name"
                type="text"
                value={clusterName}
                onChange={(event) => {
                  setClusterName(event.target.value);
                  if (event.target.value.trim()) setClusterError("");
                }}
                placeholder="e.g. production-cluster"
                className="w-full bg-[#09090b] border border-zinc-800 text-xs font-mono py-2 px-3 focus:border-zinc-600 focus:outline-none rounded-md text-white placeholder:text-neutral-500"
              />
              {clusterError && <p className="mt-2 text-sm text-red-400">{clusterError}</p>}
            </div>

            <div>
              <label htmlFor="cluster-environment" className="mb-2 block text-sm font-medium text-neutral-200">
                Environment
              </label>
              <div className="relative">
                <select
                  id="cluster-environment"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as "development" | "staging" | "production")}
                  className="w-full appearance-none bg-[#09090b] border border-zinc-800 text-xs font-mono py-2 px-3 pr-8 focus:border-zinc-600 focus:outline-none rounded-md text-white cursor-pointer"
                >
                  <option value="development">Development (Minikube / Kind)</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production (AWS EKS)</option>
                </select>
                <Icon
                  path={mdiChevronDown}
                  size={0.6}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium text-neutral-200">Kubeconfig File</p>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`rounded-xl border border-dashed p-8 text-center transition-colors ${
                  isDragging ? "border-blue-500 bg-blue-500/10" : "border-zinc-800 bg-[#09090b]"
                }`}
              >
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Icon path={mdiUpload} size={0.83} />
                </div>
                <p className="text-neutral-300 text-sm">Drag & drop your kubeconfig here</p>
                <p className="my-1.5 text-xs text-neutral-500">or</p>
                <p className="mb-3 text-xs text-neutral-500">YAML files only (.yaml, .yml)</p>
                <label className="inline-flex cursor-pointer rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors">
                  Browse File
                  <input type="file" accept=".yaml,.yml" className="hidden" onChange={handleFileChange} />
                </label>

                {kubeconfigFile && (
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <p className="text-sm text-emerald-400 font-mono">Selected: {kubeconfigFile.name}</p>
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
                {fileError && <p className="mt-4 text-sm text-red-400">{fileError}</p>}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-zinc-300 font-mono text-xs">
              <p className="mb-1 text-zinc-500">Cluster Name</p>
              <p className="font-semibold text-zinc-200">{clusterName}</p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-zinc-300 font-mono text-xs">
              <p className="mb-1 text-zinc-500">Environment</p>
              <p className="font-semibold text-zinc-200 capitalize">{environment}</p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-[#09090b] p-3 text-zinc-300 font-mono text-xs">
              <p className="mb-1 text-zinc-500">Kubeconfig Payload</p>
              <div className="flex items-center justify-between">
                <p className="font-semibold text-zinc-200">{kubeconfigFile?.name}</p>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded bg-emerald-500/10 px-3 py-2 text-emerald-400 border border-emerald-500/20">
                <Icon path={mdiCheck} size={0.7} />
                <span className="text-xs font-medium">Kubeconfig securely loaded in memory</span>
              </div>
            </div>

            {formattedError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-start gap-2.5">
                  <Icon path={mdiAlertCircle} size={0.7} className="mt-0.5 shrink-0 text-red-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-red-300">Connection Failed</p>
                    <p className="mt-1 text-xs text-red-400/80 leading-relaxed">{formattedError.friendly}</p>
                    {formattedError.details && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowErrorDetails(!showErrorDetails)}
                          className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-400 underline underline-offset-2 transition-colors"
                        >
                          {showErrorDetails ? "Hide" : "Show"} Technical Details
                        </button>
                        {showErrorDetails && (
                          <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-black/40 p-2 text-[10px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-all">
                            {formattedError.details}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!connectionError && (
              <p className="text-sm text-neutral-400">
                Review the details above and connect your Kubernetes cluster.
              </p>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 1) {
                onClose();
              } else {
                setConnectionError("");
                setShowErrorDetails(false);
                previousStep();
              }
            }}
          >
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step < 3 ? (
            <Button onClick={nextStep}>Next</Button>
          ) : (
            <Button onClick={handleConnect} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : connectionError ? "Try Again" : "Connect Cluster"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
