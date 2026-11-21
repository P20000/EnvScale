import { Icon } from "../ui/Icon";
import { mdiArrowRight, mdiKubernetes } from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

interface LandingScrollFooterProps {
  onGetStarted: () => void;
}

export function LandingScrollFooter({ onGetStarted }: LandingScrollFooterProps) {
  return (
    <footer className="w-full border-t border-slate-200 bg-white py-14 px-4 sm:px-6 select-none">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200/80 shadow-xs">
            <EnvScaleLogo className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <div className="font-heading font-bold text-sm text-slate-900">
              EnvScale Platform
            </div>
            <div className="font-heading text-xs text-slate-500">
              Multi-Tenant Kubernetes Observability &amp; Gamified Governance
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={onGetStarted}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-heading font-bold text-white hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20 active:scale-98"
          >
            <Icon path={mdiKubernetes} size={0.65} />
            <span>Launch Platform</span>
            <Icon path={mdiArrowRight} size={0.6} />
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl border-t border-slate-100 mt-6 pt-4 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-slate-500 gap-2">
        <div>RFC 6455 Streaming &bull; client-go Informers &bull; MIT License</div>
        <div>Core Engine: Pranav &bull; REST/Vault: Vinit &bull; Visuals: Neha &bull; QA/Docs: Ishika</div>
      </div>
    </footer>
  );
}
