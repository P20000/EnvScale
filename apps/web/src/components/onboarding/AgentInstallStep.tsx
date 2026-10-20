import { useState, useEffect } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiContentCopy,
  mdiCheck,
  mdiConsole,
  mdiServerNetwork,
  mdiCheckCircle,
  mdiClockOutline,
  mdiRefresh,
} from "@mdi/js";
import { Button } from "../ui/button";
import { API_BASE_URL, STREAMER_BASE_URL } from "../../config/api";

interface AgentInstallStepProps {
  clusterId: string;
  clusterName: string;
  onConnected: () => void;
}

export function AgentInstallStep({ clusterId, clusterName, onConnected }: AgentInstallStepProps) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"waiting" | "connected">("waiting");
  const [isChecking, setIsChecking] = useState(false);

  // Retrieve user JWT token
  const token =
    localStorage.getItem("envscale_auth_token") ||
    localStorage.getItem("envscale_access_token") ||
    "";

  const hostUrl =
    API_BASE_URL.startsWith("http")
      ? API_BASE_URL
      : typeof window !== "undefined"
      ? window.location.origin
      : "https://envscale.duckdns.org";

  const manifestUrl = `${hostUrl}/api/v1/clusters/${clusterId}/agent.yaml?token=${token}`;
  const installCmd = `kubectl apply -f "${manifestUrl}"`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      const streamerHost = STREAMER_BASE_URL.startsWith("http")
        ? STREAMER_BASE_URL
        : typeof window !== "undefined"
        ? window.location.origin
        : "https://envscale.duckdns.org";

      const res = await fetch(
        `${streamerHost}/api/v1/clusters/snapshot?clusterId=${encodeURIComponent(
          clusterId
        )}&token=${encodeURIComponent(token)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      if (res.ok) {
        setStatus("connected");
      }
    } catch {
      // Still waiting
    } finally {
      setIsChecking(false);
    }
  };

  // Poll for agent connection every 3 seconds while waiting
  useEffect(() => {
    if (status === "connected") return;

    let isMounted = true;
    const poll = async () => {
      try {
        const streamerHost = STREAMER_BASE_URL.startsWith("http")
          ? STREAMER_BASE_URL
          : typeof window !== "undefined"
          ? window.location.origin
          : "https://envscale.duckdns.org";

        const res = await fetch(
          `${streamerHost}/api/v1/clusters/snapshot?clusterId=${encodeURIComponent(
            clusterId
          )}&token=${encodeURIComponent(token)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );

        if (res.ok && isMounted) {
          setStatus("connected");
        }
      } catch {
        // Still waiting
      }
    };

    const timeout = setTimeout(poll, 300);
    const interval = setInterval(poll, 3000);

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [clusterId, token, status]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400">
            <Icon path={mdiServerNetwork} size={0.8} />
          </div>
          <div className="text-xs">
            <h4 className="font-semibold text-neutral-100">Zero-Config In-Cluster Agent</h4>
            <p className="mt-1 text-neutral-300 leading-relaxed">
              Run this single command inside your Kubernetes environment. The lightweight agent connects
              outbound to EnvScale without exposing ports or changing firewall rules.
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
            <Icon path={mdiConsole} size={0.65} className="text-blue-400" />
            Terminal Installation Command
          </label>
          <button
            type="button"
            onClick={copyToClipboard}
            className="flex items-center gap-1 text-[11px] font-mono text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.6} />
            {copied ? "Copied!" : "Copy Command"}
          </button>
        </div>

        <div className="relative rounded-xl border border-zinc-800 bg-black/60 p-3.5 font-mono text-xs text-neutral-200">
          <p className="break-all select-all text-emerald-400/90 leading-relaxed">{installCmd}</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800/80 bg-[#14161C] p-3 text-xs text-neutral-400 space-y-2">
        <p className="font-medium text-neutral-300">Compatible with:</p>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-0.5 text-neutral-300">
            Minikube
          </span>
          <span className="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-0.5 text-neutral-300">
            KinD (Kubernetes in Docker)
          </span>
          <span className="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-0.5 text-neutral-300">
            Kubeadm / On-Prem
          </span>
          <span className="rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-0.5 text-neutral-300">
            AWS EKS / GKE / AKS
          </span>
        </div>
      </div>

      {status === "waiting" ? (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5">
          <div className="flex items-center gap-2.5">
            <Icon path={mdiClockOutline} size={0.7} className="animate-spin text-amber-400" />
            <div>
              <p className="text-xs font-semibold text-amber-300">Waiting for Agent Stream...</p>
              <p className="text-[11px] text-amber-400/80">
                Apply the manifest above in your terminal. We will detect it automatically.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={checkConnection}
            disabled={isChecking}
            className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/20 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/30 transition-colors"
          >
            <Icon path={mdiRefresh} size={0.55} className={isChecking ? "animate-spin" : ""} />
            {isChecking ? "Checking..." : "Check"}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
          <div className="flex items-center gap-2.5">
            <Icon path={mdiCheckCircle} size={0.8} className="text-emerald-400" />
            <div>
              <p className="text-xs font-semibold text-emerald-300">Agent Connected Successfully!</p>
              <p className="text-[11px] text-emerald-400/80">
                Live topology data stream is flowing for cluster "{clusterName}".
              </p>
            </div>
          </div>
          <Button onClick={onConnected} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs py-1.5 px-3">
            Open Canvas
          </Button>
        </div>
      )}
    </div>
  );
}
