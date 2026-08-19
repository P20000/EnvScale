import type { Request, Response } from "express";
import { z } from "zod";
import {
  ClusterConnectionError,
  connectCluster,
  deleteCluster,
  listClusters,
} from "../services/cluster.service.js";

const idSchema = z.string().uuid();
const connectSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(50).default("kubernetes"),
  kubeconfig: z.string().min(1).max(2_000_000),
});

const parseId = (value: unknown, response: Response, label: string) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    response.status(400).json({ error: `Invalid ${label}` });
    return undefined;
  }
  return parsed.data;
};

export const connect = async (request: Request, response: Response) => {
  const workspaceId = parseId(request.params.id, response, "workspace id");
  const parsed = connectSchema.safeParse(request.body);
  if (!workspaceId) return;
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid cluster data", details: parsed.error.flatten() });
    return;
  }

  try {
    response.status(201).json(await connectCluster(workspaceId, parsed.data));
  } catch (error: unknown) {
    if (error instanceof ClusterConnectionError) {
      response.status(422).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const list = async (request: Request, response: Response) => {
  const workspaceId = parseId(request.params.id, response, "workspace id");
  if (!workspaceId) return;
  response.json(await listClusters(workspaceId));
};

export const remove = async (request: Request, response: Response) => {
  const workspaceId = parseId(request.params.id, response, "workspace id");
  const clusterId = parseId(request.params.clusterId, response, "cluster id");
  if (!workspaceId || !clusterId) return;
  await deleteCluster(workspaceId, clusterId);
  response.status(204).send();
};