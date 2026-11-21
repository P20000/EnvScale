/**
 * EnvScale Application Error Types & Presentation Models
 * Governs error handling across 400s (Client/Auth), 500s (Server/Infra), and 300s (Redirects/OAuth)
 */

export type ErrorPresentationVariant = "fullscreen" | "modal" | "banner" | "inline";

export interface AppError {
  id: string;
  status: number;
  title: string;
  message: string;
  details?: string;
  endpoint?: string;
  timestamp: number;
  variant: ErrorPresentationVariant;
  requiredRole?: "ADMIN" | "MEMBER" | "VIEWER" | string;
  currentRole?: string;
  targetWorkspace?: string;
  retryAction?: () => Promise<void> | void;
  canDismiss?: boolean;
}

export interface HealthCheckStatus {
  isChecking: boolean;
  attempts: number;
  lastCheckedAt: number | null;
  serverReachable: boolean;
}
