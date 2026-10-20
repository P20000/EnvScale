import { Icon } from "../ui/Icon";
import { mdiArrowRight } from "@mdi/js";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";
import { LandingMandala } from "./LandingMandala";
import { LandingTopologyMotion } from "./LandingTopologyMotion";

interface LandingVideoHeroProps {
  onGetStarted: () => void;
}

export function LandingVideoHero({ onGetStarted }: LandingVideoHeroProps) {
  return (
    <section className="relative w-full min-h-[70vh] sm:min-h-[85vh] flex flex-col items-center justify-center bg-slate-50 pt-24 pb-16 px-4 sm:px-6 select-none overflow-hidden">
      {/* Background Mandala Ambient Watermarks */}
      <LandingMandala
        size="2xl"
        className="absolute -top-32 -right-32 text-blue-500/[0.05] rotate-12"
      />
      <LandingMandala
        size="xl"
        className="absolute -bottom-28 -left-28 text-blue-600/[0.05] -rotate-45"
      />

      {/* Dynamic Random Kubernetes Topology Tree Motion Graphics Layer */}
      <LandingTopologyMotion />

      {/* Centered Brand Presentation */}
      <div className="relative z-10 max-w-xl mx-auto flex flex-col items-center justify-center text-center space-y-5">
        {/* Big Logo of ENVSCALE with Mandala Art Centered Directly Behind It */}
        <div className="relative flex items-center justify-center transition-transform duration-500 hover:scale-105">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none -z-10 flex items-center justify-center">
            <LandingMandala
              size="md"
              className="text-blue-500/[0.14] sm:scale-110"
            />
          </div>
          <EnvScaleLogo className="h-28 w-28 sm:h-36 sm:w-36 text-blue-600 relative z-10" />
        </div>

        {/* Title: ENVSCALE */}
        <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-wider text-slate-900 uppercase">
          ENVSCALE
        </h1>

        {/* Get Started Button just below ENVSCALE */}
        <div className="pt-2">
          <button
            onClick={onGetStarted}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-8 py-3 text-sm font-heading font-bold text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/25 active:scale-95"
          >
            <span>Get Started</span>
            <Icon path={mdiArrowRight} size={0.7} />
          </button>
        </div>
      </div>
    </section>
  );
}
