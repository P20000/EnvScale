/**
 * EnvScale API Client Configuration & REST Handlers
 * Target REST API backend: http://localhost:3000
 * Target Streaming Gateway: http://localhost:8080
 */

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export const STREAMER_BASE_URL =
  import.meta.env.VITE_STREAMER_BASE_URL || "http://localhost:8080";

import { useTopologyStore } from "../store/useTopologyStore";

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

export async function apiRegister(userData: {
  name: string;
  email: string;
  password: string;
}): Promise<LoginResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    const data = (await res.json()) as LoginResponse;
    if (!res.ok) {
      return { error: data.message || data.error || `Registration failed (${res.status})` };
    }
    return data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error: Unable to connect to auth server" };
  }
}

export async function apiDevQuickLogin(): Promise<LoginResponse> {
  let res = await apiLogin({ email: "dev@envscale.local", password: "Password123!" });
  if (res.error) {
    res = await apiRegister({ name: "Local Dev User", email: "dev@envscale.local", password: "Password123!" });
  }
  if (res.accessToken) {
    localStorage.setItem("envscale_auth_token", res.accessToken);
    useTopologyStore.getState().triggerWsReconnect();
  }
  return res;
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
  workspaceId?: string;
}): Promise<ClusterResponse> {
  try {
    // 1. Direct registration removed; API server now handles it with correct UUID
    // 2. Persist cluster registration in REST API server (http://localhost:3000)

    // 2. Persist cluster registration in REST API server (http://localhost:3000)
    try {
      const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (rawAuth && rawAuth !== "null") {
        headers["Authorization"] = `Bearer ${rawAuth}`;
      }

      const wsId = clusterData.workspaceId;
      const targetUrl = wsId
        ? `${API_BASE_URL}/api/v1/workspaces/${wsId}/clusters/connect`
        : `${API_BASE_URL}/api/v1/clusters`;

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          name: clusterData.name,
          type: clusterData.environment || "development",
          kubeconfig: clusterData.kubeconfig || "",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`[EnvScale] Cluster "${clusterData.name}" persisted to PostgreSQL DB`);
        // The backend returns the cluster object at the root level (e.g. { id, name, type, ... }).
        // Normalize into the { cluster: { id, name } } shape the wizard expects.
        const cluster = data.cluster || data;
        return { cluster: { id: cluster.id, name: cluster.name, environment: cluster.type } } as ClusterResponse;
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn("[EnvScale] REST server cluster persistence error response:", errJson);
        return { error: errJson.error || errJson.message || `Failed to save cluster to database (${res.status})` };
      }
    } catch (dbErr) {
      console.warn("[EnvScale] REST server cluster persistence offline/warning:", dbErr);
      return { error: dbErr instanceof Error ? dbErr.message : "Database connection error" };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Network error: Unable to register cluster",
    };
  }
}

export async function apiGetWorkspaces() {
  try {
    const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
    const headers: Record<string, string> = {};
    if (rawAuth && rawAuth !== "null") headers["Authorization"] = `Bearer ${rawAuth}`;
    
    const res = await fetch(`${API_BASE_URL}/api/v1/workspaces`, {
      headers,
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Failed to fetch user workspaces:", err);
  }
  return [];
}

export async function apiGetWorkspaceClusters(workspaceId: string) {
  try {
    const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
    const headers: Record<string, string> = {};
    if (rawAuth && rawAuth !== "null") headers["Authorization"] = `Bearer ${rawAuth}`;

    const res = await fetch(`${API_BASE_URL}/api/v1/workspaces/${workspaceId}/clusters`, {
      headers,
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`Failed to fetch clusters for workspace ${workspaceId}:`, err);
  }
  return [];
}

export async function apiMe() {
  try {
    const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
    const headers: Record<string, string> = {};
    if (rawAuth && rawAuth !== "null") headers["Authorization"] = `Bearer ${rawAuth}`;

    const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
      headers,
      credentials: "include",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("Failed to fetch current user session:", err);
  }
  return null;
}

/**
 * Disconnect/Unregister K8s Cluster
 */
export async function apiDisconnectCluster(clusterId: string): Promise<boolean> {
  try {
    await fetch(`${STREAMER_BASE_URL}/api/v1/clusters?clusterId=${encodeURIComponent(clusterId)}`, {
      method: "DELETE",
    });

    const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
    const headers: Record<string, string> = {};
    if (rawAuth && rawAuth !== "null") headers["Authorization"] = `Bearer ${rawAuth}`;

    const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${clusterId}`, {
      method: "DELETE",
      headers,
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const getStreamerToken = async (): Promise<string | null> => {
  try {
    const rawAuth = localStorage.getItem("envscale_auth_token");
    const rawAccess = localStorage.getItem("envscale_access_token");
    const localToken = (rawAuth && rawAuth !== "null") ? rawAuth : ((rawAccess && rawAccess !== "null") ? rawAccess : null);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
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
