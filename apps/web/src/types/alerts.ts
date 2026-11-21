export type AlertMetric = "cpu" | "memory" | "pod_crash";

export type AlertOperator =
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  duration: string;
  namespace: string;
  severity: AlertSeverity;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
