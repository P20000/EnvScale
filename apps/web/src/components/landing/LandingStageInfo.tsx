import type { ScrollStageData } from "./landingTypes";

interface LandingStageInfoProps {
  stage: ScrollStageData;
}

export function LandingStageInfo({ stage }: LandingStageInfoProps) {
  return (
    <div className="relative flex flex-col justify-center space-y-6 select-none overflow-visible py-4">
      {/* Title in Google Sans & Subtitle in Courgette */}
      <div className="relative z-10 space-y-3">
        <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight">
          {stage.title}
        </h2>
        <p className="font-courgette text-lg sm:text-xl text-slate-600 font-normal leading-relaxed">
          {stage.subtitle}
        </p>
      </div>

      {/* Primary Narrative in Courgette cursive font */}
      <p className="font-courgette text-xl sm:text-2xl text-slate-700 leading-relaxed tracking-wide italic">
        &ldquo;{stage.description}&rdquo;
      </p>
    </div>
  );
}
