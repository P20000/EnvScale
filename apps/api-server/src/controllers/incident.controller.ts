import type { Request, Response } from "express";
import { getIncident, listIncidents, resolveIncident } from "../services/incident.service.js";

export const list = async (request: Request, response: Response) => {
  response.json(await listIncidents(request.params.id as string));
};

export const resolve = async (request: Request, response: Response) => {
  const incident = await getIncident(request.params.incidentId as string);
  if (!incident) {
    response.status(404).json({ error: "Incident not found" });
    return;
  }

  response.json(
    await resolveIncident(
      incident.id,
      request.user!.id,
      request.body.resolution
    )
  );
};