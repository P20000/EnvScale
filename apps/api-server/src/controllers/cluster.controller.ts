import type { Request, Response } from "express";
import {
  ClusterConnectionError,
  ClusterNotFoundError,
  connectCluster,
  deleteCluster,
  listClusters,
} from "../services/cluster.service.js";

import { ensureDefaultWorkspace } from "../services/workspace.service.js";

export const connect = async (request: Request, response: Response) => {
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
  const workspaceId = request.params.id as string;
  response.json(await listClusters(workspaceId));
};

export const remove = async (request: Request, response: Response) => {
  let workspaceId = request.params.id as string | undefined;

  if (!workspaceId && request.user) {
    const workspace = await ensureDefaultWorkspace(request.user.id, request.user.name);
    workspaceId = workspace.id;
  }

  if (!workspaceId) {
    response.status(401).json({ error: "Authentication required to delete cluster" });
    return;
  }

  const clusterId = request.params.clusterId as string;
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