import { Icon } from "../ui/Icon";
import {
  mdiAlertCircle,
  mdiAlert,
  mdiInformation,
  mdiCheckCircle,
} from "@mdi/js";

export type Severity = "critical" | "warning" | "minor" | "info" | "CRITICAL" | "WARNING" | "INFO";

export function IncidentSeverityCell({ severity }: { severity: Severity }) {
  const sevKey = severity.toLowerCase() as "critical" | "warning" | "minor" | "info";
  const configs = {
    critical: {
      path: mdiAlertCircle,
      bg: "bg-red-500/5",
      text: "text-red-400",
      border: "border-red-500/20",
      label: "Critical",
    },
    warning: {
      path: mdiAlert,
      bg: "bg-amber-500/5",
      text: "text-amber-400",
      border: "border-amber-500/20",
      label: "High",
    },
    minor: {
      path: mdiInformation,
      bg: "bg-yellow-500/5",
      text: "text-yellow-400",
      border: "border-yellow-500/20",
      label: "Minor",
    },
    info: {
      path: mdiCheckCircle,
      bg: "bg-blue-500/5",
      text: "text-blue-400",
      border: "border-blue-500/20",
      label: "Info",
    },
  };

  const current = configs[sevKey] || configs.info;

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold border rounded-full ${current.bg} ${current.text} ${current.border}`}>
      <Icon path={current.path} size={0.55} />
      <span>{current.label}</span>
    </div>
  );
}
