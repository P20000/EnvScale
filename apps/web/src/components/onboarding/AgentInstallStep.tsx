import { useState, useEffect, useCallback } from "react";
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
import { API_BASE_URL, STREAMER_BASE_URL, apiCreateManifestToken, getStreamerToken } from "../../config/api";

interface AgentInstallStepProps {
  clusterId: string;
  clusterName: string;
  onConnected: () => void;
}

export function AgentInstallStep({ clusterId, clusterName, onConnected }: AgentInstallStepProps) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"waiting" | "connected">("waiting");
  const [isChecking, setIsChecking] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [manifestToken, setManifestToken] = useState<string>("");
  const [manifestLoading, setManifestLoading] = useState<boolean>(true);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const loadManifestToken = useCallback(async () => {
    setManifestLoading(true);
    setManifestError(null);
    const res = await apiCreateManifestToken(clusterId);
    if (res.token) {
      setManifestToken(res.token);
      setManifestError(null);
    } else {
      setManifestToken("");
      setManifestError(res.error || "Unable to issue manifest download token");
    }
    setManifestLoading(false);
  }, [clusterId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await apiCreateManifestToken(clusterId);
      if (!active) return;
      if (res.token) {
        setManifestToken(res.token);
        setManifestError(null);
      } else {
        setManifestToken("");
        setManifestError(res.error || "Unable to issue manifest download token");
      }
      setManifestLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [clusterId]);

  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const hostUrl =
    API_BASE_URL.startsWith("http")
      ? API_BASE_URL
      : typeof window !== "undefined"
      ? (isLocalhost ? "http://localhost:3000" : window.location.origin)
      : "http://localhost:3000";

  const manifestUrl = manifestToken
    ? `${hostUrl}/api/v1/clusters/${clusterId}/agent.yaml?token=${encodeURIComponent(manifestToken)}${
        tunnelUrl.trim() ? `&serverUrl=${encodeURIComponent(tunnelUrl.trim())}` : ""
      }`
    : "";
  const installCmd = manifestUrl ? `kubectl apply -f "${manifestUrl}"` : "";

  const copyToClipboard = () => {
    if (!installCmd) return;
    navigator.clipboard.writeText(installCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resolveStreamerHost = useCallback(
    () =>
      STREAMER_BASE_URL.startsWith("http")
        ? STREAMER_BASE_URL
        : typeof window !== "undefined"
        ? (isLocalhost ? "http://localhost:8080" : window.location.origin)
        : "http://localhost:8080",
    [isLocalhost]
  );

  const checkConnection = async () => {
    setIsChecking(true);
    setPollError(null);
    try {
      const streamerHost = resolveStreamerHost();
      const streamerTok = await getStreamerToken();
      if (!streamerTok) {
        setPollError("Session expired or streamer token unavailable. Please sign in again.");
        return;
      }

      const res = await fetch(
        `${streamerHost}/api/v1/clusters/snapshot?clusterId=${encodeURIComponent(clusterId)}`,
        {
          headers: { Authorization: `Bearer ${streamerTok}` },
        }
      );

      if (res.ok) {
        setPollError(null);
        setStatus("connected");
      } else if (res.status === 401 || res.status === 403) {
        setPollError(`Cluster access rejected (HTTP ${res.status}). Check workspace permissions.`);
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
        const streamerHost = resolveStreamerHost();
        const streamerTok = await getStreamerToken();
        if (!streamerTok) {
          if (isMounted) setPollError("Unable to acquire streamer session token.");
          return;
        }

        const res = await fetch(
          `${streamerHost}/api/v1/clusters/snapshot?clusterId=${encodeURIComponent(clusterId)}`,
          {
            headers: { Authorization: `Bearer ${streamerTok}` },
          }
        );

        if (res.ok && isMounted) {
          setPollError(null);
          setStatus("connected");
        } else if ((res.status === 401 || res.status === 403) && isMounted) {
          setPollError(`Cluster access rejected (HTTP ${res.status}).`);
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
  }, [clusterId, status, resolveStreamerHost]);

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
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void loadManifestToken()}
              disabled={manifestLoading}
              className="flex items-center gap-1 text-[11px] font-mono text-neutral-300 hover:text-neutral-100 transition-colors disabled:opacity-50"
            >
              <Icon path={mdiRefresh} size={0.55} className={manifestLoading ? "animate-spin" : ""} />
              Regenerate
            </button>
            <button
              type="button"
              onClick={copyToClipboard}
              disabled={!installCmd || manifestLoading}
              className="flex items-center gap-1 text-[11px] font-mono text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-40"
            >
              <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.6} />
              {copied ? "Copied!" : "Copy Command"}
            </button>
          </div>
        </div>

        <div className="relative rounded-xl border border-zinc-800 bg-black/60 p-3.5 font-mono text-xs text-neutral-200">
          {manifestError ? (
            <p className="text-red-400 leading-relaxed">{manifestError}</p>
          ) : manifestLoading || !installCmd ? (
            <p className="text-neutral-400 leading-relaxed">Generating single-use manifest download token...</p>
          ) : (
            <p className="break-all select-all text-emerald-400/90 leading-relaxed">{installCmd}</p>
          )}
        </div>

        {isLocalhost && (
          <div className="mt-2.5 rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 text-[11px] text-neutral-300 space-y-2">
            <div>
              <span className="font-semibold text-blue-400">Remote Cloud Notice (AWS EKS / GKE): </span>
              Cloud pods cannot reach <code>localhost</code>. For cloud clusters, we recommend the <strong>Kubeconfig File</strong> mode, or specify a public tunnel URL (e.g. Cloudflare / ngrok) below:
            </div>
            <input
              type="text"
              placeholder="e.g. wss://your-tunnel.ngrok-free.app/ws/agent"
              value={tunnelUrl}
              onChange={(e) => setTunnelUrl(e.target.value)}
              className="w-full bg-[#111318] border border-zinc-700/60 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-200 placeholder:text-neutral-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}
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
        <div className="space-y-2">
          {pollError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {pollError}
            </div>
          )}
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
