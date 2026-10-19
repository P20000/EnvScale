/**
 * EnvScale API Client Configuration & REST Handlers
 * Target REST API backend: http://localhost:3000
 * Target Streaming Gateway: http://localhost:8080
 */

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== "undefined" && window.location.origin ? window.location.origin : "http://localhost:3000");

export const STREAMER_BASE_URL =
  import.meta.env.VITE_STREAMER_BASE_URL ||
  (typeof window !== "undefined" && window.location.origin ? window.location.origin : "http://localhost:8080");

export function getAuthHeaders(contentType?: string): Record<string, string> {
  const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
  const headers: Record<string, string> = contentType ? { "Content-Type": contentType } : {};
  if (rawAuth && rawAuth !== "null") headers["Authorization"] = `Bearer ${rawAuth}`;
  return headers;
}

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

export interface SwitchSessionResponse {
  token?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  workspace?: {
    id: string;
    name: string;
    slug: string;
  };
  allowedClusterIds?: string[];
  error?: string;
}

export async function apiSwitchSession(params: {
  accountId?: string;
  email?: string;
}): Promise<SwitchSessionResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/switch-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as SwitchSessionResponse;
    if (!res.ok) {
      return { error: data.error || `Switch session failed (${res.status})` };
    }
    return data;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Network error" };
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
  workspaceId?: string;
}): Promise<ClusterResponse> {
  try {
    try {
      const wsId = clusterData.workspaceId;
      const targetUrl = wsId
        ? `${API_BASE_URL}/api/v1/workspaces/${wsId}/clusters/connect`
        : `${API_BASE_URL}/api/v1/clusters`;

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: getAuthHeaders("application/json"),
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
    const res = await fetch(`${API_BASE_URL}/api/v1/workspaces`, {
      headers: getAuthHeaders(),
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
    const res = await fetch(`${API_BASE_URL}/api/v1/workspaces/${workspaceId}/clusters`, {
      headers: getAuthHeaders(),
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

export async function apiGetStreamerClusters(): Promise<Array<{ id: string; name: string; status?: string }>> {
  try {
    const res = await fetch(`${STREAMER_BASE_URL}/api/v1/clusters`);
    if (res.ok) {
      const data = await res.json();
      if (data?.clusters && typeof data.clusters === "object") {
        return Object.keys(data.clusters).map((id) => {
          const clusterObj = (data.clusters as Record<string, { status?: string }>)[id];
          return {
            id,
            name: id === "minikube" ? "Minikube Local" : (id.length > 20 ? `Cluster (${id.slice(0, 8)})` : id),
            status: clusterObj?.status || "CONNECTED",
          };
        });
      }
    }
  } catch {
    // Streamer gateway offline or network unreachable
  }
  return [];
}

export async function apiMe() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
      headers: getAuthHeaders(),
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
    let token = await getStreamerToken();
    if (!token) {
      const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
      if (rawAuth && rawAuth !== "null") token = rawAuth;
    }
    const streamerHeaders: Record<string, string> = {};
    if (token) streamerHeaders["Authorization"] = `Bearer ${token}`;

    await fetch(`${STREAMER_BASE_URL}/api/v1/clusters?clusterId=${encodeURIComponent(clusterId)}`, {
      method: "DELETE",
      headers: streamerHeaders,
    });

    const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${clusterId}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
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
      if (data.token) {
        localStorage.setItem("envscale_auth_token", data.token);
      }
      return data.token || null;
    }
  } catch (error) {
    console.error("Failed to fetch streamer token", error);
  }
  return null;
};

export interface RollbackParams {
  clusterId: string;
  namespace: string;
  deploymentName: string;
  replicaSetName?: string;
  targetRevision?: string;
  targetHash?: string;
}

export interface RollbackResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Trigger an authenticated rollback of a deployment to a target ReplicaSet
 * Endpoint: POST /api/v1/clusters/:id/rollout/rollback
 */
export async function apiRollbackDeployment(params: RollbackParams): Promise<RollbackResponse> {
  try {
    let token = await getStreamerToken();
    if (!token) {
      const rawAuth = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
      if (rawAuth && rawAuth !== "null") token = rawAuth;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${STREAMER_BASE_URL}/api/v1/clusters/${encodeURIComponent(params.clusterId)}/rollout/rollback`, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Rollback failed (HTTP ${res.status})` };
    }
    return { success: true, message: data.message || "Rollback initiated successfully" };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Network error during rollback";
    return { success: false, error: errorMsg };
  }
}

/**
 * Retrieve saved canvas layout positions for a cluster
 * Endpoint: GET /api/v1/clusters/:clusterId/layout
 */
export async function apiGetClusterLayout(clusterId: string): Promise<Record<string, { x: number; y: number }>> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${encodeURIComponent(clusterId)}/layout`, {
      headers: getAuthHeaders(),
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      return (data?.positions || {}) as Record<string, { x: number; y: number }>;
    }
  } catch (err) {
    console.warn(`Failed to fetch layout for cluster ${clusterId}:`, err);
  }
  return {};
}

/**
 * Persist custom canvas layout positions for a cluster
 * Endpoint: PUT /api/v1/clusters/:clusterId/layout
 */
export async function apiSaveClusterLayout(
  clusterId: string,
  positions: Record<string, { x: number; y: number }>
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${encodeURIComponent(clusterId)}/layout`, {
      method: "PUT",
      headers: getAuthHeaders("application/json"),
      credentials: "include",
      body: JSON.stringify({ positions }),
    });
    return res.ok;
  } catch (err) {
    console.warn(`Failed to save layout for cluster ${clusterId}:`, err);
    return false;
  }
}

/**
 * Reset custom canvas layout positions for a cluster (reverts to autolayout)
 * Endpoint: DELETE /api/v1/clusters/:clusterId/layout
 */
export async function apiResetClusterLayout(clusterId: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${encodeURIComponent(clusterId)}/layout`, {
      method: "DELETE",
      headers: getAuthHeaders(),
      credentials: "include",
    });
    return res.ok;
  } catch (err) {
    console.warn(`Failed to reset layout for cluster ${clusterId}:`, err);
    return false;
  }
}

