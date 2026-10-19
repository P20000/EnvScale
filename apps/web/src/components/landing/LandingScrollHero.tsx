import { Icon } from "../ui/Icon";
import {
  mdiArrowRight,
  mdiChevronDown,
  mdiKubernetes,
  mdiPulse,
  mdiShieldLockOutline,
  mdiTrophyVariantOutline,
} from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

interface LandingScrollHeroProps {
  onGetStarted: () => void;
  onScrollToStoryline: () => void;
}

export function LandingScrollHero({
  onGetStarted,
  onScrollToStoryline,
}: LandingScrollHeroProps) {
  return (
    <section className="relative min-h-[90vh] w-full flex flex-col justify-between items-center text-center px-4 sm:px-6 pt-16 pb-12 select-none">
      {/* Top Brand Pill (No Navigation Bar) */}
      <div className="flex items-center gap-2.5 rounded-full border border-[#30343B] bg-[#191B20] px-3.5 py-1.5 text-xs font-mono text-[#E6E1E5] shadow-sm">
        <EnvScaleLogo className="h-4 w-4 text-[#A8C7FA]" />
        <span className="font-bold tracking-wider uppercase font-heading">EnvScale Platform</span>
        <span className="text-[#92959D]">&bull;</span>
        <span className="text-[#6DD6A8]">v0.2.0-milestone2</span>
      </div>

      {/* Main Hero Narrative */}
      <div className="max-w-4xl space-y-6 my-auto">
        <div className="inline-flex items-center gap-2 rounded-sm border border-[#30343B] bg-[#191B20] px-3 py-1 text-xs font-mono text-[#A8C7FA]">
          <Icon path={mdiKubernetes} size={0.65} />
          <span>MULTI-TENANT KUBERNETES OBSERVABILITY & RESILIENCE</span>
        </div>

        <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#E6E1E5] leading-[1.12]">
          Real-Time Cluster Topology & Gamified Governance
        </h1>

        <p className="text-sm sm:text-base lg:text-lg text-[#C4C7C5] max-w-2xl mx-auto leading-relaxed">
          Eliminate polling lag and ephemeral crash blind spots. EnvScale captures Kubernetes state via Go Informers and streams sub-200ms deltas directly to an ArgoCD-grade Dagre canvas with dynamic health index scoring.
        </p>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <button
            onClick={onGetStarted}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-md bg-[#A8C7FA] px-6 py-3 text-sm font-bold text-[#102F50] hover:bg-[#D3E3FD] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8C7FA] shadow-lg shadow-blue-500/10 active:scale-98"
          >
            <span>Get Started</span>
            <Icon path={mdiArrowRight} size={0.7} />
          </button>

          <button
            onClick={onScrollToStoryline}
            className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-md border border-[#30343B] bg-[#191B20] px-5 py-3 text-sm font-medium text-[#E6E1E5] hover:bg-[#23262D] hover:border-[#424750] transition-colors"
          >
            <span>Explore Architecture</span>
            <Icon path={mdiChevronDown} size={0.7} />
          </button>
        </div>

        {/* Feature Highlights Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-6 text-left">
          <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 flex items-center gap-2.5">
            <Icon path={mdiPulse} size={0.8} className="text-[#6DD6A8] shrink-0" />
            <div>
              <div className="text-xs font-semibold text-[#E6E1E5]">Sub-200ms Deltas</div>
              <div className="text-[10px] text-[#92959D]">Gorilla WebSocket stream</div>
            </div>
          </div>

          <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 flex items-center gap-2.5">
            <Icon path={mdiTrophyVariantOutline} size={0.8} className="text-[#F4C26B] shrink-0" />
            <div>
              <div className="text-xs font-semibold text-[#E6E1E5]">Health Score 0–100</div>
              <div className="text-[10px] text-[#92959D]">Algorithmic crash penalties</div>
            </div>
          </div>

          <div className="rounded-md border border-[#30343B] bg-[#191B20] p-3 flex items-center gap-2.5">
            <Icon path={mdiShieldLockOutline} size={0.8} className="text-[#A8C7FA] shrink-0" />
            <div>
              <div className="text-xs font-semibold text-[#E6E1E5]">AES-256-GCM Vault</div>
              <div className="text-[10px] text-[#92959D]">Zero plaintext Kubeconfigs</div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Scroll Cue */}
      <button
        onClick={onScrollToStoryline}
        className="flex flex-col items-center gap-1.5 text-xs font-mono text-[#92959D] hover:text-[#E6E1E5] transition-colors pt-4"
      >
        <span>Scroll down to examine real-time streaming pipeline</span>
        <Icon path={mdiChevronDown} size={0.75} className="animate-bounce" />
      </button>
    </section>
  );
}
