import { API_BASE_URL, STREAMER_BASE_URL, getAuthHeaders, getStreamerToken } from "./api";

export interface ManifestTokenResponse {
  token: string | null;
  error?: string;
  status?: number;
}

export const apiCreateManifestToken = async (clusterId: string): Promise<ManifestTokenResponse> => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/clusters/${encodeURIComponent(clusterId)}/manifest-token`, {
      method: "POST",
      headers: getAuthHeaders("application/json"),
      credentials: "include",
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        token: null,
        status: res.status,
        error: errData.error || `Failed to mint manifest token (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as { token?: string };
    return { token: data.token || null };
  } catch (err) {
    return {
      token: null,
      error: err instanceof Error ? err.message : "Network error generating manifest token",
    };
  }
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
    const token = await getStreamerToken();
    if (!token) {
      return { success: false, error: "Unable to acquire streamer session token. Please sign in again." };
    }

    const res = await fetch(
      `${STREAMER_BASE_URL}/api/v1/clusters/${encodeURIComponent(params.clusterId)}/rollout/rollback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      }
    );

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

