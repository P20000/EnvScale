import { z } from "zod";

export const connectClusterSchema = z.object({
  name: z.string().trim().min(1, "Cluster name is required").max(255, "Cluster name is too long"),
  environment: z.enum(["development", "staging", "production"], {
    errorMap: () => ({ message: "Invalid environment selected" }),
  }),
  kubeconfig: z.string().min(1, "Please upload a kubeconfig file").refine(
    (text) => text.includes("apiVersion") && text.includes("clusters"),
    { message: "Invalid Kubeconfig file: Missing 'apiVersion' or 'clusters' specification in YAML." }
  ),
});

export type ConnectClusterInput = z.infer<typeof connectClusterSchema>;

/**
 * Translates raw Go / network error strings into concise, actionable
 * user-facing messages. The original error is preserved for the
 * collapsible "Technical Details" section.
 */
export function formatConnectionError(raw: string): { friendly: string; details: string } {
  const lower = raw.toLowerCase();

  if (lower.includes("x509") || lower.includes("certificate")) {
    return {
      friendly:
        "TLS certificate verification failed. This is common with local Minikube clusters — EnvScale will retry with a secure fallback automatically.",
      details: raw,
    };
  }
  if (lower.includes("connection refused")) {
    return {
      friendly:
        "Could not connect to the Kubernetes API server. Make sure your cluster is running (e.g. minikube start).",
      details: raw,
    };
  }
  if (lower.includes("no such host") || lower.includes("dial tcp")) {
    return {
      friendly:
        "DNS resolution failed — the cluster API server address could not be reached. Check your kubeconfig.",
      details: raw,
    };
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden")) {
    return {
      friendly:
        "Authentication failed — the credentials in your kubeconfig may be expired or invalid.",
      details: raw,
    };
  }
  if (lower.includes("timeout") || lower.includes("deadline")) {
    return {
      friendly:
        "Connection timed out. The cluster API server may be slow or unreachable.",
      details: raw,
    };
  }

  return { friendly: raw, details: "" };
}
