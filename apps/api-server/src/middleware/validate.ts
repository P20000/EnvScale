import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";

type ValidationSource = "body" | "params" | "query";

export const validate = <Schema extends z.ZodTypeAny>(
  source: ValidationSource,
  schema: Schema,
  message = `Invalid request ${source}`
): RequestHandler =>
  (request: Request, response: Response, next: NextFunction) => {
    const parsed = schema.safeParse(request[source]);
    if (!parsed.success) {
      response.status(400).json({ error: message, details: parsed.error.flatten() });
      return;
    }
    request[source] = parsed.data;
    next();
  };