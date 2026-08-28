// ============================================================================
// VIN-15: Environment Variable Schema Validation (Zod)
// ============================================================================
// Validates all required environment variables at startup using Zod schemas.
// In production mode, enforces stricter rules (no wildcard CORS, secure keys).
// ============================================================================

import { z } from "zod";

/**
 * Zod schema for environment variable validation.
 * Coerces PORT to a number, validates DATABASE_URL format,
 * and enforces required secret keys.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid PostgreSQL connection URI")
    .min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z
    .string()
    .min(1, "JWT_ACCESS_SECRET is required"),

  JWT_REFRESH_SECRET: z
    .string()
    .min(1, "JWT_REFRESH_SECRET is required"),

  ENCRYPTION_KEY: z
    .string()
    .optional(),

  CORS_ORIGIN: z
    .string()
    .default("*"),

  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().optional().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

/**
 * Parse and validate environment variables.
 * Exits the process with a descriptive error if validation fails.
 */
function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Environment variable validation failed:");
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  const env = result.data;

  // Production-mode guardrails
  if (env.NODE_ENV === "production") {
    if (env.CORS_ORIGIN === "*") {
      console.error(
        "❌ CORS_ORIGIN cannot be wildcard '*' in production. Set explicit allowed origins."
      );
      process.exit(1);
    }

    if (
      env.JWT_ACCESS_SECRET === "replace-with-a-long-random-access-secret" ||
      env.JWT_REFRESH_SECRET === "replace-with-a-different-long-random-refresh-secret"
    ) {
      console.error(
        "❌ JWT secrets must be replaced from default placeholder values in production."
      );
      process.exit(1);
    }
  }

  // Development-mode warnings
  if (env.NODE_ENV === "development") {
    if (env.CORS_ORIGIN === "*") {
      console.warn(
        "⚠️  CORS_ORIGIN is set to wildcard '*'. This is acceptable in development only."
      );
    }
  }

  return env;
}

/** Validated environment configuration */
export const env = parseEnv();

export type Env = z.infer<typeof envSchema>;
