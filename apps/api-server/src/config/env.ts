// ============================================================================
// VIN-15: Environment Variable Schema Validation (Zod)
// ============================================================================
// Validates all required environment variables at startup using Zod schemas.
// In production mode, enforces stricter rules (no wildcard CORS, secure keys).
// ============================================================================

import { z } from "zod";

/**
 * Treat empty strings and the Terraform/SSM placeholder sentinel "DISABLED"
 * (case-insensitive) as unset for optional OAuth credentials.
 */
export function normalizeOptionalCredential(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === "DISABLED") return undefined;
  return trimmed;
}

const optionalOAuthCredential = z.preprocess(
  normalizeOptionalCredential,
  z.string().optional(),
);

/**
 * Zod schema for environment variable validation.
 * Coerces PORT to a number, validates DATABASE_URL format,
 * and enforces required secret keys.
 */
export const envSchema = z.object({
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

  KUBECONFIG_ENCRYPTION_KEY: z
    .string()
    .optional(),

  CORS_ORIGIN: z
    .string()
    .default("*"),

  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().optional().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: optionalOAuthCredential,
  GOOGLE_CLIENT_SECRET: optionalOAuthCredential,

  GITHUB_CLIENT_ID: optionalOAuthCredential,
  GITHUB_CLIENT_SECRET: optionalOAuthCredential,
});

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "default_dev_access_secret_do_not_use_in_prod",
  "default_dev_refresh_secret_do_not_use_in_prod",
  "replace-with-a-long-random-access-secret",
  "replace-with-a-different-long-random-refresh-secret",
]);

/**
 * Pure validation helper for startup environment configuration (enforces SEC-L1 & SEC-L2).
 */
export function validateEnvConfig(rawEnv: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    throw new Error(`Environment variable validation failed: ${JSON.stringify(result.error.flatten().fieldErrors)}`);
  }

  const env = result.data;

  // Validate base64 32-byte key whenever KUBECONFIG_ENCRYPTION_KEY is supplied
  if (env.KUBECONFIG_ENCRYPTION_KEY !== undefined && env.KUBECONFIG_ENCRYPTION_KEY.trim() !== "") {
    const keyBytes = Buffer.from(env.KUBECONFIG_ENCRYPTION_KEY.trim(), "base64");
    if (keyBytes.length !== 32) {
      throw new Error("KUBECONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
    }
  }

  if (env.NODE_ENV === "production") {
    if (env.CORS_ORIGIN.includes("*")) {
      throw new Error("CORS_ORIGIN cannot contain wildcard '*' in production. Set explicit allowed origins.");
    }

    if (
      KNOWN_PLACEHOLDER_SECRETS.has(env.JWT_ACCESS_SECRET.trim()) ||
      KNOWN_PLACEHOLDER_SECRETS.has(env.JWT_REFRESH_SECRET.trim())
    ) {
      throw new Error("JWT secrets must be replaced from default placeholder values in production.");
    }

    if (env.JWT_ACCESS_SECRET.trim().length < 32 || env.JWT_REFRESH_SECRET.trim().length < 32) {
      throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be at least 32 characters in production.");
    }

    if (!env.KUBECONFIG_ENCRYPTION_KEY || !env.KUBECONFIG_ENCRYPTION_KEY.trim()) {
      throw new Error("KUBECONFIG_ENCRYPTION_KEY is required in production.");
    }
  }

  return env;
}

/**
 * Parse and validate environment variables.
 * Exits the process with a descriptive error if validation fails.
 */
function parseEnv() {
  let env: z.infer<typeof envSchema>;
  try {
    env = validateEnvConfig(process.env);
  } catch (err) {
    console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
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
