import { useResourceLogs } from "./useResourceLogs";

interface UsePodLogsOptions {
  podName: string | null;
  namespace?: string;
  enabled?: boolean;
  maxLogs?: number;
}

export function usePodLogs({
  podName,
  namespace = "default",
  enabled = true,
  maxLogs = 500,
}: UsePodLogsOptions) {
  return useResourceLogs({
    name: podName,
    kind: "Pod",
    namespace,
    enabled,
    maxLogs,
  });
}
