import type { Request, Response } from "express";
import {
  AlertPolicyValidationError,
  createAlertPolicy,
  deleteAlertPolicy,
  getAlertPolicy,
  listAlertPolicies,
  toggleAlertPolicy,
  updateAlertPolicy,
} from "../services/alert-policy.service.js";

const notFound = (response: Response) => {
  response.status(404).json({ error: "Alert policy not found" });
};

export const create = async (request: Request, response: Response) => {
  try {
    response.status(201).json(
      await createAlertPolicy(request.params.id as string, request.user!.id, request.body)
    );
  } catch (error: unknown) {
    if (error instanceof AlertPolicyValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const list = async (request: Request, response: Response) => {
  response.json(await listAlertPolicies(request.params.id as string));
};

export const get = async (request: Request, response: Response) => {
  const policy = await getAlertPolicy(request.params.policyId as string);
  if (!policy) {
    notFound(response);
    return;
  }
  response.json(policy);
};

export const update = async (request: Request, response: Response) => {
  try {
    const policy = await updateAlertPolicy(request.params.policyId as string, request.body);
    if (!policy) {
      notFound(response);
      return;
    }
    response.json(policy);
  } catch (error: unknown) {
    if (error instanceof AlertPolicyValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
};

export const remove = async (request: Request, response: Response) => {
  const policy = await getAlertPolicy(request.params.policyId as string);
  if (!policy) {
    notFound(response);
    return;
  }
  await deleteAlertPolicy(policy.id);
  response.status(204).send();
};

export const toggle = async (request: Request, response: Response) => {
  const policy = await toggleAlertPolicy(
    request.params.policyId as string,
    request.body.isEnabled
  );
  if (!policy) {
    notFound(response);
    return;
  }
  response.json(policy);
};