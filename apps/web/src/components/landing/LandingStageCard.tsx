import { Icon } from "../ui/Icon";
import {
  mdiKubernetes,
  mdiPulse,
  mdiServerNetwork,
  mdiTrophyVariantOutline,
  mdiCheckCircleOutline,
  mdiKeyOutline,
  mdiShieldCheckOutline,
} from "@mdi/js";
import type { ScrollStageData } from "./landingTypes";

interface LandingStageCardProps {
  stage: ScrollStageData;
}

export function LandingStageCard({ stage }: LandingStageCardProps) {
  const { id } = stage;

  return (
    <div className="relative w-full rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xl shadow-blue-950/5 overflow-hidden transition-all duration-300 select-none">
      {/* Top Card Badge / Stage Number */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-xs font-mono font-bold text-blue-700 border border-blue-200/60">
            {stage.stageNumber}
          </span>
          <span className="font-heading text-xs font-bold uppercase tracking-wider text-slate-500">
            {id === "ingestion" && "ARCHITECTURAL BOTTLENECK: LEGACY POLLING"}
            {id === "streaming" && "STREAMING INFORMER PIPELINE"}
            {id === "governance" && "HEALTH ALGORITHM & STREAKS"}
            {id === "security" && "CRYPTOGRAPHIC VAULT & RBAC"}
          </span>
        </div>
        {id === "ingestion" ? (
          <span className="text-xs font-mono font-bold text-rose-600 tracking-tight">
            O(N) API Overhead
          </span>
        ) : (
          <span className="text-xs font-mono font-semibold text-blue-600 tracking-tight">
            STAGE {stage.stageNumber}
          </span>
        )}
      </div>

      {/* Dynamic Diagram Body */}
      <div className="min-h-[220px] flex items-center justify-center">
        {/* STAGE 1: Timeline Diagram — Polling Blind Spot */}
        {id === "ingestion" && (
          <div className="w-full py-2">
            {/* Timeline Axis Header Ticks */}
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mb-1">
              <div>
                <span className="font-semibold text-slate-800">t = 0s</span>
                <span className="text-[10px] text-slate-400 block -mt-0.5">(Poll #1)</span>
              </div>
              <div className="text-right">
                <span className="font-semibold text-slate-800">t = 30s</span>
                <span className="text-[10px] text-slate-400 block -mt-0.5">(Poll #2)</span>
              </div>
            </div>

            {/* Horizontal Timeline Bar with Notches */}
            <div className="relative w-full h-4 flex items-center mb-3">
              <div className="w-full h-px bg-slate-300" />
              {/* Ticks across the timeline: 0%, 25%, 50%, 75%, 100% */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-px h-3 bg-slate-400" />
              <div className="absolute left-1/4 top-1/2 -translate-y-1/2 w-px h-2 bg-slate-300" />
              <div className="absolute left-2/4 top-1/2 -translate-y-1/2 w-px h-2 bg-slate-300" />
              <div className="absolute left-3/4 top-1/2 -translate-y-1/2 w-px h-2 bg-slate-300" />
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-3 bg-slate-400" />
            </div>

            {/* Diagram Event Flow: Poll #1 | Silent Downtime Window | Poll #2 */}
            <div className="grid grid-cols-12 gap-2 items-stretch">
              {/* Poll #1 Block */}
              <div className="col-span-3 rounded-xl border border-amber-300/80 bg-amber-50/70 p-2.5 text-center flex flex-col justify-center shadow-xs">
                <div className="text-[11px] font-mono font-bold text-amber-900 leading-tight">
                  GET /api/v1/pods
                </div>
                <div className="text-[10px] text-amber-800/80 mt-0.5">
                  Full State Dump
                </div>
              </div>

              {/* Silent Downtime Window (Blind Spot) */}
              <div className="col-span-6 rounded-xl border-2 border-dashed border-rose-500 bg-rose-50/80 p-2.5 text-center flex flex-col justify-center shadow-xs">
                <div className="text-xs font-heading font-extrabold text-rose-700 tracking-tight">
                  SILENT DOWNTIME WINDOW (15s-30s Blind Spot)
                </div>
                <div className="text-[10px] font-mono text-rose-600/90 mt-1">
                  Transient OOMKilled &bull; CrashLoopBackOff (&lt;5s lifetime)
                </div>
              </div>

              {/* Poll #2 Block */}
              <div className="col-span-3 rounded-xl border border-amber-300/80 bg-amber-50/70 p-2.5 text-center flex flex-col justify-center shadow-xs">
                <div className="text-[11px] font-mono font-bold text-amber-900 leading-tight">
                  GET /api/v1/pods
                </div>
                <div className="text-[10px] text-amber-800/80 mt-0.5">
                  Stale Snapshot
                </div>
              </div>
            </div>

            {/* Timeline Axis Footer Ticks */}
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mt-3 pt-1">
              <div>
                <div className="w-px h-2 bg-slate-300 mx-auto mb-1" />
                <span className="font-semibold text-slate-800">t = 0s</span>
                <span className="text-[10px] text-slate-400 block -mt-0.5">(Poll #1)</span>
              </div>
              <div className="text-right">
                <div className="w-px h-2 bg-slate-300 ml-auto mb-1" />
                <span className="font-semibold text-slate-800">t = 30s</span>
                <span className="text-[10px] text-slate-400 block -mt-0.5">(Poll #2)</span>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 2: Client-Go Informer Pipeline Flow */}
        {id === "streaming" && (
          <div className="w-full space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-center space-y-1.5">
                <div className="h-8 w-8 mx-auto rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Icon path={mdiKubernetes} size={0.8} />
                </div>
                <div className="text-xs font-heading font-bold text-slate-800">Watch Stream</div>
                <div className="text-[10px] font-mono text-slate-500">Persistent HTTP/2</div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-center space-y-1.5 shadow-sm">
                <div className="h-8 w-8 mx-auto rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Icon path={mdiPulse} size={0.8} />
                </div>
                <div className="text-xs font-heading font-bold text-emerald-900">DeltaFIFO Cache</div>
                <div className="text-[10px] font-mono text-emerald-700">Zero-Polling Watchers</div>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-center space-y-1.5">
                <div className="h-8 w-8 mx-auto rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                  <Icon path={mdiServerNetwork} size={0.8} />
                </div>
                <div className="text-xs font-heading font-bold text-blue-900">Gorilla WS Hub</div>
                <div className="text-[10px] font-mono text-blue-700">Redis Multiplexed</div>
              </div>
            </div>

            {/* Ingestion Payload Specimen */}
            <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-200 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800 pb-1.5">
                <span>SUB-SECOND WEBSOCKET PAYLOAD</span>
                <span className="text-emerald-400 font-bold">&lt; 14ms Wire Latency</span>
              </div>
              <div className="text-blue-300 text-[11px] overflow-x-auto">
                {`{ "event": "EVENT_POD_STATUS_CHANGED", "pod": "auth-api-891d", "status": "Running", "restarts": 0 }`}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-600">Client Ingestion Guarantee:</span>
              <span className="font-bold text-emerald-600">&lt; 200ms sub-second delivery</span>
            </div>
          </div>
        )}

        {/* STAGE 3: Algorithmic Health Formula & Streaks */}
        {id === "governance" && (
          <div className="w-full space-y-5">
            {/* Mathematical Formula Box */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-1 text-center">
              <div className="text-[10px] font-mono font-bold uppercase text-blue-700 tracking-wider">
                DETERMINISTIC PENALTY FORMULA
              </div>
              <div className="font-mono text-xs sm:text-sm font-bold text-slate-800">
                Score = max(0, min(100, 100 - (P<sub>fail</sub> × 15) - (R<sub>24h</sub> × 2) - (M<sub>strain</sub> × 10)))
              </div>
            </div>

            {/* Score Simulation Display */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex flex-col justify-between">
                <div className="text-[10px] font-mono uppercase text-slate-500">Live Health Index</div>
                <div className="text-3xl font-heading font-black text-emerald-600 my-1">94 / 100</div>
                <div className="text-[11px] font-heading font-semibold text-emerald-700">Pristine Cluster State</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="text-[10px] font-mono uppercase text-slate-500">Deduction Audit</div>
                <div className="text-xs font-mono text-slate-700 flex justify-between">
                  <span>Failed Pods (0):</span>
                  <span className="text-emerald-600 font-bold">0 pts</span>
                </div>
                <div className="text-xs font-mono text-slate-700 flex justify-between">
                  <span>24h Restarts (3):</span>
                  <span className="text-amber-600 font-bold">-6 pts</span>
                </div>
                <div className="text-xs font-mono text-slate-700 flex justify-between">
                  <span>Memory Strain (0):</span>
                  <span className="text-emerald-600 font-bold">0 pts</span>
                </div>
              </div>
            </div>

            {/* Objective Governance Milestones */}
            <div className="grid grid-cols-2 gap-3 text-xs font-heading">
              <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-2.5 shadow-sm">
                <Icon path={mdiTrophyVariantOutline} size={0.8} className="text-amber-500 shrink-0" />
                <div>
                  <div className="font-bold text-slate-800">14-Day Streak</div>
                  <div className="text-[10px] text-slate-500">Zero Crash Loops</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-2.5 shadow-sm">
                <Icon path={mdiCheckCircleOutline} size={0.8} className="text-emerald-500 shrink-0" />
                <div>
                  <div className="font-bold text-slate-800">MTTR: 4.2 Min</div>
                  <div className="text-[10px] text-slate-500">Automated Resolution</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 4: AES-256-GCM Vault & RBAC */}
        {id === "security" && (
          <div className="w-full space-y-4">
            {/* Cipher Envelope Diagram */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-heading font-bold text-slate-800 border-b border-slate-200 pb-2">
                <span className="flex items-center gap-1.5 text-blue-700">
                  <Icon path={mdiKeyOutline} size={0.65} />
                  <span>AES-256-GCM Cipher Vault</span>
                </span>
                <span className="text-emerald-600 font-mono text-[11px]">Zero Plaintext</span>
              </div>

              <div className="rounded-lg bg-white p-3 font-mono text-[11px] space-y-1.5 border border-slate-200/80">
                <div className="text-slate-500">Ciphertext: 4f9812bc88d92a1... (AES encrypted)</div>
                <div className="text-blue-600">IV Vector: 12-byte cryptographically random IV</div>
                <div className="text-emerald-600">Auth Tag: 16-byte Galois verification tag</div>
              </div>
            </div>

            {/* RBAC Boundaries Grid */}
            <div className="grid grid-cols-3 gap-2.5 text-center text-xs font-heading">
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                <div className="font-bold text-blue-800">ADMIN</div>
                <div className="text-[10px] text-slate-600 mt-0.5">Cluster CRUD</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <div className="font-bold text-emerald-800">MEMBER</div>
                <div className="text-[10px] text-slate-600 mt-0.5">Ops &amp; Log Tailing</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="font-bold text-slate-700">VIEWER</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Read-Only View</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3.5 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-600 flex items-center gap-1.5">
                <Icon path={mdiShieldCheckOutline} size={0.65} className="text-blue-600" />
                <span>Cluster Reconnection:</span>
              </span>
              <span className="font-bold text-blue-700">Self-Healing Workers</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
