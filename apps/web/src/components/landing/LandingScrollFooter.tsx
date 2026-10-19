import { Icon } from "../ui/Icon";
import { mdiArrowRight, mdiKubernetes } from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

interface LandingScrollFooterProps {
  onGetStarted: () => void;
}

export function LandingScrollFooter({ onGetStarted }: LandingScrollFooterProps) {
  return (
    <footer className="w-full border-t border-[#30343B] bg-[#111318] py-14 px-4 sm:px-6 select-none">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#284568] text-[#A8C7FA]">
            <EnvScaleLogo className="h-4 w-4 text-[#A8C7FA]" />
          </div>
          <div>
            <div className="font-heading font-bold text-sm text-[#E6E1E5]">
              EnvScale Platform
            </div>
            <div className="text-xs text-[#92959D]">
              Multi-tenant Kubernetes Observability & Gamified Governance
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={onGetStarted}
            className="flex items-center gap-2 rounded-md bg-[#A8C7FA] px-4 py-2 text-xs font-bold text-[#102F50] hover:bg-[#D3E3FD] transition-colors"
          >
            <Icon path={mdiKubernetes} size={0.65} />
            <span>Get Started</span>
            <Icon path={mdiArrowRight} size={0.6} />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl border-t border-[#30343B] mt-6 pt-4 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-[#92959D] gap-2">
        <div>RFC 6455 Streaming &bull; client-go Informers &bull; MIT License</div>
        <div>Core Engine: Pranav &bull; REST/Vault: Vinit &bull; Visuals: Neha &bull; QA/Docs: Ishika</div>
      </div>
    </footer>
  );
}
