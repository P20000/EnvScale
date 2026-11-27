import type { Request, Response } from "express";
import {
  ClusterConnectionError,
  ClusterNotFoundError,
  connectCluster,
  deleteCluster,
  listClusters,
  getClusterLayout,
  saveClusterLayout,
  resetClusterLayout,
  getClusterById,
} from "../services/cluster.service.js";

import { generateAgentManifest } from "../services/agent-manifest.service.js";
import { createManifestDownloadToken } from "../services/auth.service.js";
import { ensureDefaultWorkspace } from "../services/workspace.service.js";

export const connect = async (request: Request, response: Response) => {
  if (request.isServiceToken) {
    response.status(403).json({ error: "User workspace membership required" });
    return;
  }
  let workspaceId = request.params.id as string | undefined;

  try {
    if (!workspaceId && request.user) {
      const workspace = await ensureDefaultWorkspace(request.user.id, request.user.name);
      workspaceId = workspace.id;
    }

    if (!workspaceId) {
      response.status(401).json({ error: "Authentication required to connect cluster" });
      return;
    }

    response.status(201).json(await connectCluster(workspaceId, request.body));
  } catch (error: unknown) {
    if (error instanceof ClusterConnectionError) {
      response.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const list = async (request: Request, response: Response) => {
  if (request.isServiceToken) {
    response.status(403).json({ error: "User workspace membership required" });
    return;
  }
  let workspaceId = request.params.id as string | undefined;

  if (!workspaceId && request.user) {
    try {
      const workspace = await ensureDefaultWorkspace(request.user.id, request.user.name);
      workspaceId = workspace?.id;
    } catch {
      // fallback
    }
  }

  if (!workspaceId) {
    response.status(401).json({ error: "Authentication required to list clusters" });
    return;
  }

  response.json(await listClusters(workspaceId));
};

export const remove = async (request: Request, response: Response) => {
  let workspaceId = request.authorizedWorkspaceId || (request.params.id as string | undefined);

  if (!workspaceId && request.user) {
    const workspace = await ensureDefaultWorkspace(request.user.id, request.user.name);
    workspaceId = workspace.id;
  }

  if (!workspaceId) {
    response.status(401).json({ error: "Authentication required to delete cluster" });
    return;
  }

  const clusterId = request.authorizedClusterId || (request.params.clusterId as string);
  try {
    await deleteCluster(workspaceId, clusterId);
    response.status(204).send();
  } catch (error: unknown) {
    if (error instanceof ClusterNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const getLayout = async (request: Request, response: Response) => {
  const clusterId = request.authorizedClusterId;
  if (!clusterId) {
    response.status(403).json({ error: "Cluster access denied" });
    return;
  }
  const userId = request.user?.id;
  try {
    const layout = await getClusterLayout(clusterId, userId);
    response.json(layout);
  } catch (error: unknown) {
    if (error instanceof ClusterNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const saveLayout = async (request: Request, response: Response) => {
  const clusterId = request.authorizedClusterId;
  if (!clusterId) {
    response.status(403).json({ error: "Cluster access denied" });
    return;
  }
  const userId = request.user?.id;
  const { positions } = request.body as { positions: Record<string, { x: number; y: number }> };
  try {
    const result = await saveClusterLayout(clusterId, positions, userId);
    response.json(result);
  } catch (error: unknown) {
    if (error instanceof ClusterNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const resetLayout = async (request: Request, response: Response) => {
  const clusterId = request.authorizedClusterId;
  if (!clusterId) {
    response.status(403).json({ error: "Cluster access denied" });
    return;
  }
  const userId = request.user?.id;
  try {
    const result = await resetClusterLayout(clusterId, userId);
    response.json(result);
  } catch (error: unknown) {
    if (error instanceof ClusterNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const createManifestToken = async (request: Request, response: Response) => {
  const clusterId = request.authorizedClusterId;
  if (!clusterId || !request.user) {
    response.status(403).json({ error: "Cluster access denied" });
    return;
  }
  const token = createManifestDownloadToken(request.user.id, clusterId);
  response.setHeader("Cache-Control", "no-store");
  response.json({ token, expiresInSeconds: 300 });
};

function validateCustomServerUrl(rawUrl: string): string {
  if (/[\r\n"'`\s]/.test(rawUrl)) {
    throw new Error("serverUrl contains disallowed characters");
  }
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("serverUrl must use ws:// or wss://");
  }
  if (!parsed.host) {
    throw new Error("serverUrl must include a valid host");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "wss:") {
    throw new Error("serverUrl must use wss:// in production");
  }
  return parsed.toString();
}

export const getAgentManifest = async (request: Request, response: Response) => {
  const clusterId = request.authorizedClusterId;
  if (!clusterId) {
    response.status(403).json({ error: "Cluster access denied" });
    return;
  }
  if (request.manifestTokenClusterId && request.manifestTokenClusterId !== clusterId) {
    response.status(403).json({ error: "Manifest token is not scoped to this cluster" });
    return;
  }
  try {
    const cluster = await getClusterById(clusterId);
    if (!cluster) {
      response.status(404).send("# Error: Cluster not found");
      return;
    }

    const rawServerUrl =
      typeof request.query.serverUrl === "string" && request.query.serverUrl.trim()
        ? request.query.serverUrl.trim()
        : undefined;
    let customServerUrl: string | undefined;
    if (rawServerUrl) {
      try {
        customServerUrl = validateCustomServerUrl(rawServerUrl);
      } catch (validationErr) {
        response.status(400).send(`# Invalid serverUrl: ${validationErr instanceof Error ? validationErr.message : "invalid URL"}`);
        return;
      }
    }

    const host = request.get("host") || "envscale.duckdns.org";
    const protocol = request.protocol === "https" || host.includes("envscale.duckdns.org") ? "wss" : "ws";
    const serverUrl = customServerUrl || process.env.STREAMER_WS_URL || `${protocol}://${host}/ws/agent`;

    const manifest = generateAgentManifest({
      clusterId: cluster.id,
      clusterName: cluster.name,
      serverUrl,
    });

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/yaml");
    response.setHeader("Content-Disposition", `inline; filename="envscale-agent-${cluster.id}.yaml"`);
    response.send(manifest);
  } catch (error: unknown) {
    response.status(500).send(`# Error generating manifest: ${error instanceof Error ? error.message : "Internal error"}`);
  }
};