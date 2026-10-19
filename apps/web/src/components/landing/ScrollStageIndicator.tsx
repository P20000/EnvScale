import type { ScrollStageData, ScrollStageId } from "./landingTypes";

interface ScrollStageIndicatorProps {
  stages: ScrollStageData[];
  activeStageId: ScrollStageId;
  onSelectStage: (id: ScrollStageId) => void;
}

export function ScrollStageIndicator({
  stages,
  activeStageId,
  onSelectStage,
}: ScrollStageIndicatorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 select-none">
      {stages.map((stage) => {
        const isActive = stage.id === activeStageId;
        return (
          <button
            key={stage.id}
            onClick={() => onSelectStage(stage.id)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-mono transition-all ${
              isActive
                ? "bg-[#284568] text-[#D3E3FD] border border-[#A8C7FA]/40 font-bold"
                : "bg-[#191B20] text-[#92959D] border border-[#30343B] hover:text-[#E6E1E5] hover:bg-[#23262D]"
            }`}
          >
            <span className={isActive ? "text-[#A8C7FA]" : "text-[#5C616B]"}>
              {stage.stageNumber}
            </span>
            <span className="uppercase">{stage.id}</span>
          </button>
        );
      })}
    </div>
  );
}
