/**
 * EnvScale API Client Configuration & REST Handlers
 * Target default backend: http://localhost:8080
 */

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export interface LoginResponse {
  token?: string;
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

    const data = (await res.json()) as ClusterResponse;
    if (!res.ok) {
      return {
        error: data.message || data.error || `Failed to connect cluster (${res.status})`,
      };
    }
    return data;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Network error: Unable to connect to cluster API server",
    };
  }
}

