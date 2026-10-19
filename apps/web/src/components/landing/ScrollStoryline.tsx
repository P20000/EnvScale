import { useState } from "react";
import { Icon } from "../ui/Icon";
import { mdiLayersOutline, mdiArrowRight, mdiCheck } from "@mdi/js";
import { SCROLL_STAGES } from "./landingStages";
import { ScrollStageVisualizer } from "./ScrollStageVisualizer";
import { ScrollStageIndicator } from "./ScrollStageIndicator";
import type { ScrollStageId } from "./landingTypes";

interface ScrollStorylineProps {
  onGetStarted: () => void;
}

export function ScrollStoryline({ onGetStarted }: ScrollStorylineProps) {
  const [activeStageIndex, setActiveStageIndex] = useState(0);

  const activeStage = SCROLL_STAGES[activeStageIndex] || SCROLL_STAGES[0];

  // Optional auto-cycle or scroll step sync
  const handleSelectStage = (id: ScrollStageId) => {
    const idx = SCROLL_STAGES.findIndex((s) => s.id === id);
    if (idx !== -1) setActiveStageIndex(idx);
  };

  const handleNextStage = () => {
    if (activeStageIndex < SCROLL_STAGES.length - 1) {
      setActiveStageIndex((prev) => prev + 1);
    } else {
      onGetStarted();
    }
  };

  const handlePrevStage = () => {
    if (activeStageIndex > 0) {
      setActiveStageIndex((prev) => prev - 1);
    }
  };

  return (
    <section
      id="storyline"
      className="relative w-full border-t border-[#30343B] bg-[#191B20] py-16 sm:py-24 px-4 sm:px-6 select-none"
    >
      <div className="mx-auto max-w-7xl space-y-10">
        {/* Stage Navigation Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#30343B] pb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-sm border border-[#30343B] bg-[#111318] px-2.5 py-1 text-xs font-mono text-[#A8C7FA]">
              <Icon path={mdiLayersOutline} size={0.65} />
              <span>INTERACTIVE SCROLL STORYLINE</span>
            </div>
            <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-[#E6E1E5]">
              How EnvScale Operates Under the Hood
            </h2>
          </div>

          <ScrollStageIndicator
            stages={SCROLL_STAGES}
            activeStageId={activeStage.id}
            onSelectStage={handleSelectStage}
          />
        </div>

        {/* Dynamic Interactive Stage Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Stage Narrative & Architectural Metrics */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-2">
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#A8C7FA]">
                {activeStage.tag}
              </span>
              <h3 className="font-heading text-xl sm:text-2xl font-bold text-[#E6E1E5]">
                {activeStage.title}
              </h3>
              <p className="font-mono text-xs text-[#92959D]">
                {activeStage.subtitle}
              </p>
            </div>

            <p className="text-xs sm:text-sm text-[#C4C7C5] leading-relaxed">
              {activeStage.description}
            </p>

            {/* Architecture Details Checklist */}
            <div className="space-y-2 rounded-lg border border-[#30343B] bg-[#111318] p-4 text-xs font-mono">
              <div className="text-[10px] uppercase text-[#92959D] mb-1">
                Architectural Guarantees
              </div>
              {activeStage.architectureDetails.map((detail, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[#C4C7C5]">
                  <Icon path={mdiCheck} size={0.55} className="text-[#6DD6A8] shrink-0 mt-0.5" />
                  <span>{detail}</span>
                </div>
              ))}
            </div>

            {/* Metrics Chips Grid */}
            <div className="grid grid-cols-3 gap-2.5">
              {activeStage.metrics.map((metric, idx) => (
                <div key={idx} className="rounded-md border border-[#30343B] bg-[#111318] p-2.5 text-center">
                  <div className="text-[10px] font-mono uppercase text-[#92959D]">
                    {metric.label}
                  </div>
                  <div
                    className="font-mono text-sm font-bold mt-0.5"
                    style={{ color: metric.statusColor || "#E6E1E5" }}
                  >
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Stage Step Controller */}
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handlePrevStage}
                disabled={activeStageIndex === 0}
                className="rounded-md border border-[#30343B] bg-[#111318] px-3.5 py-1.5 text-xs font-mono text-[#C4C7C5] hover:bg-[#23262D] transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                &larr; Previous Stage
              </button>

              <div className="text-xs font-mono text-[#92959D]">
                Stage {activeStage.stageNumber} of 0{SCROLL_STAGES.length}
              </div>

              <button
                onClick={handleNextStage}
                className="flex items-center gap-1.5 rounded-md bg-[#A8C7FA] px-3.5 py-1.5 text-xs font-bold text-[#102F50] hover:bg-[#D3E3FD] transition-colors"
              >
                <span>
                  {activeStageIndex < SCROLL_STAGES.length - 1
                    ? "Next Stage"
                    : "Ready? Get Started"}
                </span>
                <Icon path={mdiArrowRight} size={0.6} />
              </button>
            </div>
          </div>

          {/* Right Column: Hardware-Accelerated Visualizer Frame */}
          <div className="lg:col-span-6">
            <ScrollStageVisualizer activeStageId={activeStage.id} />
          </div>
        </div>
      </div>
    </section>
  );
}
