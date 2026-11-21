import { useEffect, useRef } from "react";
import { SCROLL_STAGES } from "./landingStages";
import { LandingStageCard } from "./LandingStageCard";
import { LandingStageInfo } from "./LandingStageInfo";
import { LandingMandala } from "./LandingMandala";

export function ScrollStoryline() {
  const stageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("opacity-100", "translate-y-0");
            entry.target.classList.remove("opacity-0", "translate-y-8");
          }
        });
      },
      {
        threshold: 0.05,
        rootMargin: "50px",
      }
    );

    stageRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="storyline"
      className="relative w-full bg-slate-50 py-24 sm:py-32 px-4 sm:px-6 lg:px-8 overflow-hidden select-none"
    >
      {/* Background Ambient Mandala Watermarks */}
      <LandingMandala
        size="2xl"
        className="absolute top-40 -left-48 text-blue-500/[0.04] rotate-45"
      />
      <LandingMandala
        size="xl"
        className="absolute top-1/3 -right-40 text-blue-600/[0.04] -rotate-12"
      />
      <LandingMandala
        size="lg"
        className="absolute top-2/3 -left-32 text-blue-600/[0.03] rotate-180"
      />
      <LandingMandala
        size="2xl"
        className="absolute bottom-20 right-1/4 text-blue-500/[0.03] rotate-90"
      />

      <div className="mx-auto max-w-7xl space-y-20 relative z-10">
        {/* Full Showcase Video Container placed cleanly just above 'How It Works' */}
        <div className="w-full max-w-5xl mx-auto rounded-2xl overflow-hidden border border-slate-200/80 bg-white shadow-2xl shadow-blue-950/5 relative group">
          <video
            src="/gemini_generated_video.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-auto aspect-video object-cover"
          />
          {/* Subtle light vignette over video edge */}
          <div className="pointer-events-none absolute inset-0 bg-radial from-transparent via-white/5 to-slate-900/10" />
        </div>

        {/* Section Header with Fade */}
        <div className="relative text-center max-w-3xl mx-auto space-y-3 transition-all duration-700 ease-out flex flex-col items-center">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-blue-600">
            HOW IT WORKS
          </span>
          <h2 className="font-heading text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            How EnvScale Operates Under the Hood
          </h2>
          <p className="font-heading text-base sm:text-lg text-slate-600 leading-relaxed">
            From catching sneaky crashes in real time to bank-grade credential security — see why modern teams trust EnvScale to watch over their cloud.
          </p>
        </div>

        {/* 4 Architectural Stages (Alternating Card & Information on Desktop) with smooth scroll reveal */}
        <div className="space-y-28">
          {SCROLL_STAGES.map((stage, idx) => {
            const isCardFirst = idx % 2 === 0;

            return (
              <div
                key={stage.id}
                ref={(el) => {
                  stageRefs.current[idx] = el;
                }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center transition-all duration-700 ease-out"
              >
                {/* Visual Diagram Card Column */}
                <div
                  className={`lg:col-span-6 w-full ${
                    isCardFirst ? "lg:order-1" : "lg:order-2"
                  }`}
                >
                  <LandingStageCard stage={stage} />
                </div>

                {/* Information Column (Title, Courgette Subtitle & Narrative) */}
                <div
                  className={`lg:col-span-6 w-full ${
                    isCardFirst ? "lg:order-2" : "lg:order-1"
                  }`}
                >
                  <LandingStageInfo stage={stage} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
