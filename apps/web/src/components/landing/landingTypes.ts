export type ScrollStageId = "ingestion" | "streaming" | "governance" | "security";

export interface StageMetric {
  label: string;
  value: string;
  statusColor?: string;
}

export interface ScrollStageData {
  id: ScrollStageId;
  stageNumber: string;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  architectureDetails: string[];
  metrics: StageMetric[];
}
