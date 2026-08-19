import type { Request, Response } from "express";
import {
  ClusterConnectionError,
  connectCluster,
  deleteCluster,
  listClusters,
} from "../services/cluster.service.js";

export const connect = async (request: Request, response: Response) => {
  const workspaceId = request.params.id as string;

  try {
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
  const workspaceId = request.params.id as string;
  const clusterId = request.params.clusterId as string;
  await deleteCluster(workspaceId, clusterId);
  response.status(204).send();
};