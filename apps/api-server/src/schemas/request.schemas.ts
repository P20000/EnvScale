import { z } from "zod";
import { workspaceRoles } from "../middleware/auth.middleware.js";

export const idSchema = z.string().uuid();

export const credentialsSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(255),
});

export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  description: z.string().trim().max(5000).optional(),
});

export const updateWorkspaceSchema = workspaceSchema.partial().extend({
  description: z.string().trim().max(5000).nullable().optional(),
});

export const memberSchema = z.object({
  userId: idSchema,
  role: z.enum(workspaceRoles),
});

export const workspaceParamsSchema = z.object({ id: idSchema });
export const memberParamsSchema = workspaceParamsSchema.extend({ userId: idSchema });

export const clusterConnectSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(50).default("kubernetes"),
  kubeconfig: z.string().min(1).max(2_000_000),
});

export const clusterParamsSchema = z.object({
  id: idSchema,
  clusterId: idSchema,
});

export const alertPolicySchema = z.object({
  clusterId: idSchema,
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).nullable().optional(),
  metric: z.enum(["CPU", "MEMORY", "POD_RESTART"]),
  threshold: z.number().finite().min(-99_999_999.99).max(99_999_999.99),
  operator: z.enum([">", "<", ">=", "<="]),
  duration: z.number().int().positive(),
  severity: z.enum(["info", "warning", "error", "critical"]).default("warning"),
  isEnabled: z.boolean().default(true),
  conditions: z.record(z.unknown()).nullable().optional(),
  notificationChannels: z.array(z.string().trim().min(1).max(100)).optional(),
});

export const updateAlertPolicySchema = alertPolicySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const alertPolicyParamsSchema = z.object({ policyId: idSchema });

export const alertPolicyToggleSchema = z.object({
  isEnabled: z.boolean(),
});

export const incidentParamsSchema = z.object({ incidentId: idSchema });

export const incidentResolveSchema = z.object({
  resolution: z.string().trim().max(5000).nullable().optional(),
});

export const healthHistoryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});