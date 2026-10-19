import { Icon } from "../ui/Icon";
import {
  mdiKubernetes,
  mdiServerNetwork,
  mdiTrophyVariantOutline,
  mdiAlertOctagonOutline,
  mdiCheckCircleOutline,
  mdiPulse,
  mdiKeyOutline,
} from "@mdi/js";
import type { ScrollStageId } from "./landingTypes";

interface ScrollStageVisualizerProps {
  activeStageId: ScrollStageId;
}

export function ScrollStageVisualizer({ activeStageId }: ScrollStageVisualizerProps) {
  return (
    <div className="relative w-full h-[380px] sm:h-[440px] rounded-xl border border-[#30343B] bg-[#111318] p-4 sm:p-6 overflow-hidden flex flex-col justify-between shadow-2xl select-none">
      {/* Visualizer Frame Header */}
      <div className="flex items-center justify-between border-b border-[#30343B] pb-3 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full animate-pulse"
            style={{
              backgroundColor:
                activeStageId === "ingestion"
                  ? "#F2B8B5"
                  : activeStageId === "streaming"
                  ? "#6DD6A8"
                  : activeStageId === "governance"
                  ? "#F4C26B"
                  : "#A8C7FA",
            }}
          />
          <span className="text-[#E6E1E5] font-semibold uppercase tracking-wider">
            {activeStageId === "ingestion" && "SIMULATION: POLLING OVERHEAD & BLIND SPOTS"}
            {activeStageId === "streaming" && "SIMULATION: CLIENT-GO INFORMER WATCH STREAM"}
            {activeStageId === "governance" && "SIMULATION: ALGORITHMIC PENALTY RECONCILIATION"}
            {activeStageId === "security" && "SIMULATION: AES-256-GCM CIPHER VAULT"}
          </span>
        </div>
        <span className="text-[10px] text-[#92959D] hidden sm:inline">60 FPS HARDWARE ACCELERATED</span>
      </div>

      {/* Dynamic Graphic Stage View */}
      <div className="relative flex-1 flex items-center justify-center my-3 overflow-hidden">
        {/* Stage 1: The Observability Bottleneck */}
        {activeStageId === "ingestion" && (
          <div className="w-full space-y-4 animate-in fade-in duration-300">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-[#F2B8B5]/40 bg-[#410E0B]/15 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-[#F2B8B5]">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Icon path={mdiAlertOctagonOutline} size={0.65} />
                    <span>GET /api/v1/pods</span>
                  </span>
                  <span>15s Interval</span>
                </div>
                <div className="text-[11px] text-[#C4C7C5] leading-relaxed">
                  Worker poll triggered. Meanwhile, an ephemeral container crash occurred at t+4s and was missed before the next poll at t+15s.
                </div>
                <div className="rounded bg-[#191B20] p-2 text-[10px] font-mono text-[#F2B8B5] border border-[#30343B]">
                  Blind Spot: 11 seconds uncaptured downtime
                </div>
              </div>

              <div className="rounded-lg border border-[#F4C26B]/40 bg-[#191B20] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-[#F4C26B]">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Icon path={mdiKubernetes} size={0.65} />
                    <span>kube-apiserver Load</span>
                  </span>
                  <span>HTTP 429</span>
                </div>
                <div className="text-[11px] text-[#C4C7C5] leading-relaxed">
                  Repetitive full-cluster serialization creates severe CPU contention on the control plane during multi-user dashboard sessions.
                </div>
                <div className="rounded bg-[#111318] p-2 text-[10px] font-mono text-[#92959D] border border-[#30343B]">
                  API Server Rate-Limit Risk: High
                </div>
              </div>
            </div>

            <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 flex items-center justify-between text-xs font-mono">
              <span className="text-[#92959D]">Legacy Polling Latency:</span>
              <span className="text-[#F2B8B5] font-bold">15,000ms - 30,000ms delay</span>
            </div>
          </div>
        )}

        {/* Stage 2: Streaming Informer Engine */}
        {activeStageId === "streaming" && (
          <div className="w-full space-y-3 animate-in fade-in duration-300">
            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 text-center space-y-1">
                <Icon path={mdiKubernetes} size={0.75} className="mx-auto text-[#A8C7FA]" />
                <div className="text-[11px] font-mono font-bold text-[#E6E1E5]">Watch Stream</div>
                <div className="text-[9px] text-[#92959D]">Persistent HTTP/2</div>
              </div>

              <div className="rounded-md border border-[#6DD6A8]/40 bg-[#284568]/30 p-3 text-center space-y-1">
                <Icon path={mdiPulse} size={0.75} className="mx-auto text-[#6DD6A8]" />
                <div className="text-[11px] font-mono font-bold text-[#6DD6A8]">DeltaFIFO Queue</div>
                <div className="text-[9px] text-[#92959D]">Zero Repetitive Polls</div>
              </div>

              <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 text-center space-y-1">
                <Icon path={mdiServerNetwork} size={0.75} className="mx-auto text-[#A8C7FA]" />
                <div className="text-[11px] font-mono font-bold text-[#E6E1E5]">Gorilla WS Hub</div>
                <div className="text-[9px] text-[#92959D]">Sub-200ms Egress</div>
              </div>
            </div>

            {/* Wire Packet Frame */}
            <div className="rounded-lg border border-[#30343B] bg-[#191B20] p-3 font-mono text-xs space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-[#92959D]">
                <span>STREAM PAYLOAD (BINARY/JSON)</span>
                <span className="text-[#6DD6A8]">DELIVERED IN 14MS</span>
              </div>
              <div className="text-[#A8C7FA] text-[11px]">
                {`{ "event": "EVENT_POD_STATUS_CHANGED", "pod": "auth-api-891d", "status": "Running", "restarts": 0 }`}
              </div>
            </div>

            <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 flex items-center justify-between text-xs font-mono">
              <span className="text-[#92959D]">Observed Ingestion Latency:</span>
              <span className="text-[#6DD6A8] font-bold">&lt; 200ms (P99: 18ms)</span>
            </div>
          </div>
        )}

        {/* Stage 3: Algorithmic Health Governance */}
        {activeStageId === "governance" && (
          <div className="w-full space-y-3 animate-in fade-in duration-300">
            <div className="flex items-center justify-between rounded-lg border border-[#30343B] bg-[#191B20] p-4">
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase text-[#92959D]">Algorithmic Index</div>
                <div className="text-3xl font-mono font-bold text-[#6DD6A8]">94 / 100</div>
                <div className="text-[11px] text-[#6DD6A8]">Status: Pristine Workload Health</div>
              </div>
              <div className="text-right space-y-1 text-xs font-mono">
                <div>Failing Pods: <span className="text-[#6DD6A8] font-bold">0</span></div>
                <div>24h Restarts: <span className="text-[#F4C26B] font-bold">3 (-6 pts)</span></div>
                <div>Memory Strain: <span className="text-[#6DD6A8] font-bold">0</span></div>
              </div>
            </div>

            <div className="rounded-lg border border-[#30343B] bg-[#191B20] p-3 space-y-2 text-xs font-mono">
              <div className="text-[10px] uppercase text-[#A8C7FA]">Objective Governance Milestones</div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-[#111318] p-2 border border-[#30343B] flex items-center gap-1.5">
                  <Icon path={mdiTrophyVariantOutline} size={0.65} className="text-[#F4C26B]" />
                  <span>14 Days Crash-Free</span>
                </div>
                <div className="rounded bg-[#111318] p-2 border border-[#30343B] flex items-center gap-1.5">
                  <Icon path={mdiCheckCircleOutline} size={0.65} className="text-[#6DD6A8]" />
                  <span>MTTR: 4.2 Minutes</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stage 4: AES-256-GCM Vault */}
        {activeStageId === "security" && (
          <div className="w-full space-y-3 animate-in fade-in duration-300">
            <div className="rounded-lg border border-[#30343B] bg-[#191B20] p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-[#6DD6A8]">
                <span className="flex items-center gap-1.5 font-bold">
                  <Icon path={mdiKeyOutline} size={0.65} />
                  <span>Kubeconfig Vault Cipher</span>
                </span>
                <span>256-Bit GCM</span>
              </div>
              <div className="rounded bg-[#111318] p-2.5 font-mono text-[10px] space-y-1 border border-[#30343B]">
                <div className="text-[#92959D]">Ciphertext: 4f9812bc88... (encrypted)</div>
                <div className="text-[#A8C7FA]">Initialization Vector: 12-byte random IV</div>
                <div className="text-[#6DD6A8]">Auth Tag: 16-byte cryptographic verification</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="rounded border border-[#30343B] bg-[#191B20] p-2">
                <div className="font-bold text-[#A8C7FA]">ADMIN</div>
                <div className="text-[9px] text-[#92959D]">Cluster CRUD</div>
              </div>
              <div className="rounded border border-[#30343B] bg-[#191B20] p-2">
                <div className="font-bold text-[#6DD6A8]">MEMBER</div>
                <div className="text-[9px] text-[#92959D]">Ops & Logs</div>
              </div>
              <div className="rounded border border-[#30343B] bg-[#191B20] p-2">
                <div className="font-bold text-[#C4C7C5]">VIEWER</div>
                <div className="text-[9px] text-[#92959D]">Read Topology</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Visualizer Frame Footer */}
      <div className="border-t border-[#30343B] pt-2 flex items-center justify-between text-[11px] font-mono text-[#92959D]">
        <span>ENGINE ARCHITECTURE: ENVSCALE CORE</span>
        <span className="text-[#A8C7FA]">STAGE: {activeStageId.toUpperCase()}</span>
      </div>
    </div>
  );
}
