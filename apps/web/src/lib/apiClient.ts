import { useErrorStore } from "../store/useErrorStore";
import { useAuthStore } from "../store/useAuthStore";

const isViteDev =
  typeof window !== "undefined" &&
  (window.location.port === "5173" || window.location.port === "5174");

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (!isViteDev && typeof window !== "undefined" && window.location.origin ? window.location.origin : "http://localhost:3000");


export interface ApiClientOptions extends RequestInit {
  skipErrorIntercept?: boolean;
  timeoutMs?: number;
  requiredRole?: string;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  status: number;
}

/**
 * Global HTTP Client with automated status code interception & self-healing fallbacks
 */
export async function apiClient<T = unknown>(
  endpoint: string,
  options: ApiClientOptions = {}
): Promise<ApiResponse<T>> {
  const {
    skipErrorIntercept = false,
    timeoutMs = 12000,
    requiredRole,
    headers: customHeaders = {},
    ...fetchOptions
  } = options;

  // Build full URL
  const url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  // Read current auth token
  const token =
    localStorage.getItem("envscale_auth_token") ||
    localStorage.getItem("envscale_access_token");

  const headers = new Headers(customHeaders);
  if (token && token !== "null" && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!headers.has("Content-Type") && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
      credentials: fetchOptions.credentials || "include",
    });

    clearTimeout(timeoutId);

    let parsedBody: unknown = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      parsedBody = await res.json().catch(() => null);
    } else {
      parsedBody = await res.text().catch(() => null);
    }

    if (res.ok) {
      return {
        data: parsedBody as T,
        error: null,
        status: res.status,
      };
    }

    // Extract error message
    const errorMsg =
      (parsedBody && typeof parsedBody === "object" && "message" in parsedBody && typeof (parsedBody as { message: unknown }).message === "string"
        ? (parsedBody as { message: string }).message
        : (parsedBody && typeof parsedBody === "object" && "error" in parsedBody && typeof (parsedBody as { error: unknown }).error === "string"
            ? (parsedBody as { error: string }).error
            : `Request failed with HTTP ${res.status}`)) || `HTTP error ${res.status}`;

    if (!skipErrorIntercept) {
      handleStatusInterception(res.status, errorMsg, endpoint, requiredRole, () =>
        apiClient<T>(endpoint, options).then(() => undefined)
      );
    }

    return {
      data: null,
      error: errorMsg,
      status: res.status,
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const errorMessage = isAbort
      ? `Network request timed out after ${timeoutMs / 1000}s`
      : err instanceof Error
      ? err.message
      : "Unknown network error";

    if (!skipErrorIntercept) {
      // Disconnected or backend offline
      useErrorStore.getState().setError({
        status: 503,
        title: "Network Connection Interrupted",
        message: "Unable to reach EnvScale backend servers. Please verify your connection or service status.",
        details: errorMessage,
        endpoint,
        variant: "fullscreen",
        retryAction: () => apiClient<T>(endpoint, options).then(() => undefined),
      });
    }

    return {
      data: null,
      error: errorMessage,
      status: 0,
    };
  }
}

/**
 * Handle HTTP status codes according to error fallbacks matrix
 */
function handleStatusInterception(
  status: number,
  message: string,
  endpoint: string,
  requiredRole?: string,
  retryAction?: () => Promise<void> | void
) {
  const errorStore = useErrorStore.getState();

  switch (status) {
    case 401: {
      // Evict stale token & update auth store
      localStorage.removeItem("envscale_auth_token");
      localStorage.removeItem("envscale_access_token");
      localStorage.removeItem("envscale_user");
      
      const authStore = useAuthStore.getState();
      authStore.setSession(null);

      errorStore.setError({
        status: 401,
        title: "Session Expired",
        message: "Your authentication session has expired or the security key was updated. Please sign in again.",
        details: message,
        endpoint,
        variant: "fullscreen",
        retryAction,
      });
      break;
    }

    case 403: {
      // RBAC Forbidden - Show modal preserving current page context
      const user = useAuthStore.getState().user;
      errorStore.setError({
        status: 403,
        title: "Access Restricted (RBAC)",
        message: message || "You do not have the required permissions for this action.",
        details: `Endpoint: ${endpoint}`,
        requiredRole: requiredRole || "ADMIN",
        currentRole: user?.role || "VIEWER",
        endpoint,
        variant: "modal",
        canDismiss: true,
      });
      break;
    }

    case 429: {
      // Rate Limit - Trigger floating banner with 30s countdown
      errorStore.startRateLimitCountdown(30);
      errorStore.setError({
        status: 429,
        title: "Rate Limit Exceeded",
        message: "Too many requests. Temporary cooldown activated to prevent server throttling.",
        endpoint,
        variant: "banner",
        canDismiss: true,
      });
      break;
    }

    case 500: {
      // Internal Server Error
      errorStore.setError({
        status: 500,
        title: "Internal Server Error",
        message: "The server encountered an unexpected error while processing this request.",
        details: message,
        endpoint,
        variant: "fullscreen",
        retryAction,
        canDismiss: true,
      });
      break;
    }

    case 502:
    case 503:
    case 504: {
      // Infrastructure / Deployment in progress
      errorStore.setError({
        status,
        title: status === 504 ? "Gateway Timeout" : "Service Updating / Offline",
        message: "EnvScale core API is temporarily unreachable or restarting during deployment. Automatic reconnection active.",
        details: message,
        endpoint,
        variant: "fullscreen",
        retryAction,
      });
      break;
    }
  }
}
