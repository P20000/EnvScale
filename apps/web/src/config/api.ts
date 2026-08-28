/**
 * EnvScale API Client Configuration & REST Handlers
 * Target REST API backend: http://localhost:3000
 * Target Streaming Gateway: http://localhost:8080
 */

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export const STREAMER_BASE_URL =
  import.meta.env.VITE_STREAMER_BASE_URL || "http://localhost:8080";

export interface LoginResponse {
  token?: string;       // kept for compatibility
  accessToken?: string; // actual key returned by api-server /api/v1/auth/login
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  error?: string;
  message?: string;
}

export interface WorkspaceResponse {
  workspace?: {
    id: string;
    name: string;
    slug: string;
    description?: string;
  };
  error?: string;
  message?: string;
}

/**
 * Authenticate User via REST API
 * Endpoint: POST /api/v1/auth/login
 */
export async function apiLogin(credentials: {
  email: string;
  passwordHash?: string;
  password?: string;
}): Promise<LoginResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: credentials.email,
        password: credentials.password || credentials.passwordHash,
      }),
    });

    const data = (await res.json()) as LoginResponse;
    if (!res.ok) {
      return {
        error: data.message || data.error || `Authentication failed (${res.status})`,
      };
    }
    return data;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Network error: Unable to connect to auth server",
    };
  }
}

/**
 * Create Workspace via REST API
 * Endpoint: POST /api/v1/workspaces
 */
export async function apiCreateWorkspace(workspaceData: {
  name: string;
  slug?: string;
  description?: string;
}): Promise<WorkspaceResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: workspaceData.name,
        slug:
          workspaceData.slug ||
          workspaceData.name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        description: workspaceData.description || "",
      }),
    });

    const data = (await res.json()) as WorkspaceResponse;
    if (!res.ok) {
      return {
        error: data.message || data.error || `Failed to create workspace (${res.status})`,
      };
    }
    return data;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Network error: Unable to connect to API server",
    };
  }
}

export interface ClusterResponse {
  cluster?: {
    id?: string;
    name: string;
    environment?: string;
  };
  error?: string;
  message?: string;
}

/**
 * Connect K8s Cluster via REST API
 * Endpoint: POST /api/v1/clusters
 */
export async function apiConnectCluster(clusterData: {
  name: string;
  environment?: string;
  kubeconfig?: string;
}): Promise<ClusterResponse> {
  try {
    // 1. Direct registration to Go k8s-streamer gateway (http://localhost:8080) for instant streaming
    try {
      const streamerRes = await fetch(`${STREAMER_BASE_URL}/api/v1/clusters/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterId: clusterData.name,
          kubeconfig: clusterData.kubeconfig,
        }),
      });
      if (streamerRes.ok) {
        console.log(`[EnvScale] Cluster "${clusterData.name}" registered with k8s-streamer gateway`);
      } else {
        const errText = await streamerRes.text();
        console.error(`[EnvScale] Streamer registration failed (${streamerRes.status}):`, errText);
      }
    } catch (streamerErr) {
      console.warn("[EnvScale] Direct registration to k8s-streamer gateway failed:", streamerErr);
    }

    // 2. Persist cluster registration in REST API server (http://localhost:3000)
    const res = await fetch(`${API_BASE_URL}/api/v1/clusters`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: clusterData.name,
        environment: clusterData.environment || "development",
        kubeconfig: clusterData.kubeconfig || "",
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as ClusterResponse;
      return data;
    }

    return { cluster: { name: clusterData.name, environment: clusterData.environment } };
  } catch {
    // Fallback: If REST server DB is offline in dev mode, return cluster name for local streaming
    return { cluster: { name: clusterData.name, environment: clusterData.environment } };
  }
}

export const getStreamerToken = async (): Promise<string | null> => {
  try {
    const localToken =
      localStorage.getItem("envscale_auth_token") ||
      localStorage.getItem("envscale_access_token");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (localToken) {
      headers["Authorization"] = `Bearer ${localToken}`;
    }

    const res = await fetch(`${API_BASE_URL}/api/v1/auth/streamer-token`, {
      method: "GET",
      headers,
      credentials: "include",
    });
    
    if (res.ok) {
      const data = await res.json();
      return data.token || null;
    }
  } catch (error) {
    console.error("Failed to fetch streamer token", error);
  }
  return null;
};
