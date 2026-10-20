import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiClose,
  mdiChevronDown,
  mdiServerNetwork,
  mdiFileUploadOutline,
} from "@mdi/js";
import { Button } from "../ui/button";
import { apiConnectCluster, apiMe } from "../../config/api";
import { useTopologyStore } from "../../store/useTopologyStore";
import { useAuthStore } from "../../store/useAuthStore";
import { connectClusterSchema, formatConnectionError } from "./wizardHelpers";
import { ConnectSuccessScreen } from "./ConnectSuccessScreen";
import { AgentInstallStep } from "./AgentInstallStep";
import { KubeconfigUploadStep } from "./KubeconfigUploadStep";
import { DirectReviewStep } from "./DirectReviewStep";
import { WizardAuthRequiredModal } from "./WizardAuthRequiredModal";
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
  const [connectionMode, setConnectionMode] = useState<"agent" | "direct">("agent");
  const [kubeconfigFile, setKubeconfigFile] = useState<File | null>(null);
  const [kubeconfigContent, setKubeconfigContent] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const [clusterError, setClusterError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  const clusters = useTopologyStore((s) => s.clusters);
  const addCluster = useTopologyStore((s) => s.addCluster);
  const setActiveCluster = useTopologyStore((s) => s.setActiveCluster);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openAuthModal = useAuthStore((s) => s.openAuthModal);
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
    file
      .text()
      .then((text) => setKubeconfigContent(text))
      .catch(() => setKubeconfigContent(""));
  };

  const nextStep = async () => {
    if (step === 1) {
      if (!clusterName.trim()) {
        setClusterError("Cluster name is required.");
        return;
      }
      if (clusters.some((c) => c.name === clusterName.trim())) {
        setClusterError("A cluster with this name already exists.");
        return;
      }

      setClusterError("");

      if (connectionMode === "agent") {
        if (!isAuthenticated) {
          openAuthModal("Sign in to register and connect your cluster.");
          return;
        }

        setIsConnecting(true);
        setConnectionError("");

        try {
          let workspaceId: string | undefined = undefined;
          const meData = await apiMe();
          if (meData?.workspace?.id) {
            workspaceId = meData.workspace.id;
          }

          const res = await apiConnectCluster({
            name: clusterName.trim(),
            environment,
            connectionMode: "agent",
            workspaceId,
          });

          setIsConnecting(false);

          if (res.error) {
            setConnectionError(res.error);
            return;
          }

          if (res.cluster?.id) {
            const clusterObj: Cluster = {
              id: res.cluster.id,
              name: res.cluster.name,
              status: "connected",
              healthScore: 100,
              type: environment,
            };
            setConnectedCluster({ id: res.cluster.id, name: res.cluster.name });
            addCluster(clusterObj);
            setActiveCluster(res.cluster.id);
            setStep(2);
          }
        } catch (err) {
          setIsConnecting(false);
          setConnectionError(err instanceof Error ? err.message : "Failed to register cluster");
        }
        return;
      }
    }

    if (step === 2 && connectionMode === "direct") {
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

  const handleConnectDirect = async () => {
    if (!kubeconfigFile || !clusterName.trim()) return;

    if (!isAuthenticated) {
      setConnectionError("You must be signed in with an active workspace to connect a cluster.");
      return;
    }

    setIsConnecting(true);
    setConnectionError("");

    try {
      let workspaceId: string | undefined = undefined;
      const meData = await apiMe();
      if (meData?.workspace?.id) {
        workspaceId = meData.workspace.id;
      }

      const res = await apiConnectCluster({
        name: clusterName.trim(),
        environment,
        kubeconfig: kubeconfigContent,
        connectionMode: "direct",
        workspaceId,
      });

      setIsConnecting(false);

      if (res.error) {
        setConnectionError(res.error);
      } else if (!res.cluster?.id) {
        setConnectionError("Backend did not return a valid Cluster ID. Registration may have failed.");
      } else {
        const clusterObj: Cluster = {
          id: res.cluster.id,
          name: res.cluster.name,
          status: "connected",
          healthScore: 100,
          type: environment,
        };
        addCluster(clusterObj);
        setActiveCluster(res.cluster.id);
        setConnectedCluster({ id: res.cluster.id, name: res.cluster.name });
        setIsConnected(true);
      }
    } catch (err) {
      setIsConnecting(false);
      setConnectionError(err instanceof Error ? err.message : "Failed to read Kubeconfig file");
    }
  };

  const handleAgentCompleted = () => {
    if (connectedCluster) {
      const clusterObj: Cluster = {
        id: connectedCluster.id,
        name: connectedCluster.name,
        status: "connected",
        healthScore: 100,
        type: environment,
      };
      onClusterConnected?.(clusterObj);
      onClose();
    }
  };

  if (!isAuthenticated) {
    return (
      <WizardAuthRequiredModal
        onClose={onClose}
        onSignIn={() => openAuthModal("Sign in to your account or workspace to connect a new Kubernetes cluster.")}
      />
    );
  }

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
      <div className="w-full max-w-lg rounded-3xl border border-[#30343B] bg-[#191B20] shadow-none p-6 text-[#E6E1E5]">
        <div className="mb-6 flex items-start gap-4">
          <div>
            <p className="text-sm text-blue-400 font-mono">
              Step {step} of {connectionMode === "agent" ? 2 : 3}
            </p>
            <h2 className="mt-1 text-2xl font-semibold font-heading">Connect Cluster</h2>
            <p className="mt-1 max-w-full break-words text-sm leading-5 text-[#C4C7C5]">
              Observe any Kubernetes cluster live on the EnvScale platform.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto shrink-0 p-1 text-[#92959D] hover:text-[#E6E1E5] rounded-md transition-colors"
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
                placeholder="e.g. minikube-local, staging-cluster"
                className="w-full bg-[#111318] border border-[#30343B] text-xs font-mono py-2 px-3 focus:border-blue-500 focus:outline-none rounded-md text-[#E6E1E5] placeholder:text-[#92959D]"
              />
              {clusterError && <p className="mt-2 text-sm text-[#F2B8B5]">{clusterError}</p>}
            </div>

            <div>
              <label htmlFor="cluster-environment" className="mb-2 block text-sm font-medium text-[#E6E1E5]">
                Environment
              </label>
              <div className="relative">
                <select
                  id="cluster-environment"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as "development" | "staging" | "production")}
                  className="w-full appearance-none bg-[#111318] border border-[#30343B] text-xs font-mono py-2 px-3 pr-8 focus:border-blue-500 focus:outline-none rounded-md text-[#E6E1E5] cursor-pointer"
                >
                  <option value="development">Development (Minikube / KinD / Local)</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production (AWS EKS / Cloud)</option>
                </select>
                <Icon
                  path={mdiChevronDown}
                  size={0.6}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#92959D]"
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[#E6E1E5]">Connection Mode</p>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setConnectionMode("agent")}
                  className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                    connectionMode === "agent"
                      ? "border-blue-500 bg-blue-500/10 text-white"
                      : "border-zinc-800 bg-[#111318] text-neutral-400 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon path={mdiServerNetwork} size={0.75} className={connectionMode === "agent" ? "text-blue-400" : ""} />
                    <span className="text-xs font-semibold text-neutral-200">In-Cluster Agent</span>
                  </div>
                  <span className="mt-1 text-[11px] text-neutral-400 leading-snug">
                    Recommended for Minikube, KinD, & on-prem. Zero open ports needed.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setConnectionMode("direct")}
                  className={`flex flex-col items-start rounded-xl border p-3.5 text-left transition-all ${
                    connectionMode === "direct"
                      ? "border-blue-500 bg-blue-500/10 text-white"
                      : "border-zinc-800 bg-[#111318] text-neutral-400 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon path={mdiFileUploadOutline} size={0.75} className={connectionMode === "direct" ? "text-blue-400" : ""} />
                    <span className="text-xs font-semibold text-neutral-200">Kubeconfig File</span>
                  </div>
                  <span className="mt-1 text-[11px] text-neutral-400 leading-snug">
                    Upload Kubeconfig for clusters with public API endpoints.
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && connectionMode === "agent" && connectedCluster && (
          <AgentInstallStep
            clusterId={connectedCluster.id}
            clusterName={connectedCluster.name}
            onConnected={handleAgentCompleted}
          />
        )}

        {step === 2 && connectionMode === "direct" && (
          <KubeconfigUploadStep
            kubeconfigFile={kubeconfigFile}
            fileError={fileError}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
            onFileSelected={handleFile}
            onRemoveFile={() => {
              setKubeconfigFile(null);
              setKubeconfigContent("");
              setFileError("");
            }}
          />
        )}

        {step === 3 && connectionMode === "direct" && (
          <DirectReviewStep
            clusterName={clusterName}
            environment={environment}
            kubeconfigFile={kubeconfigFile}
            connectionError={connectionError}
            formattedError={formattedError}
          />
        )}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 1) {
                onClose();
              } else {
                setConnectionError("");
                previousStep();
              }
            }}
          >
            {step === 1 ? "Cancel" : "Back"}
          </Button>

          {step === 1 ? (
            <Button onClick={nextStep} disabled={isConnecting}>
              {isConnecting ? "Generating Agent..." : connectionMode === "agent" ? "Generate Agent Command" : "Next"}
            </Button>
          ) : step === 2 && connectionMode === "agent" ? (
            <Button onClick={handleAgentCompleted}>Done</Button>
          ) : step === 2 ? (
            <Button onClick={nextStep}>Next</Button>
          ) : (
            <Button onClick={handleConnectDirect} disabled={isConnecting}>
              {isConnecting ? "Connecting..." : connectionError ? "Try Again" : "Connect Cluster"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
