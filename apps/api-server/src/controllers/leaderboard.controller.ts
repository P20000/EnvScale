import type { Request, Response } from "express";
import { getLeaderboard, getWorkspaceHealthHistory } from "../services/leaderboard.service.js";

export const leaderboard = async (request: Request, response: Response) => {
  response.json(await getLeaderboard(request.user!.id));
};

export const healthHistory = async (request: Request, response: Response) => {
  const days = Number(request.query.days);
  response.json(await getWorkspaceHealthHistory(request.params.id as string, days));
};