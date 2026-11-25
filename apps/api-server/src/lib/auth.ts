import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { db } from "../db/client.js";
import { env, normalizeOptionalCredential, type Env } from "../config/env.js";

import * as schema from "../db/schema/index.js";

export type OAuthProviderEnv = Pick<
  Env,
  "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GITHUB_CLIENT_ID" | "GITHUB_CLIENT_SECRET"
>;

// Dynamically construct social providers configuration only if valid non-DISABLED client credentials exist
export function buildSocialProviders(config: OAuthProviderEnv) {
  const providers: Record<string, { clientId: string; clientSecret: string; prompt?: string; accessType?: "offline" | "online" }> = {};

  const googleId = normalizeOptionalCredential(config.GOOGLE_CLIENT_ID);
  const googleSecret = normalizeOptionalCredential(config.GOOGLE_CLIENT_SECRET);
  if (googleId && googleSecret) {
    providers.google = {
      clientId: googleId,
      clientSecret: googleSecret,
      prompt: "select_account",
      accessType: "offline",
    };
  }

  const githubId = normalizeOptionalCredential(config.GITHUB_CLIENT_ID);
  const githubSecret = normalizeOptionalCredential(config.GITHUB_CLIENT_SECRET);
  if (githubId && githubSecret) {
    providers.github = {
      clientId: githubId,
      clientSecret: githubSecret,
    };
  }

  return Object.keys(providers).length > 0 ? providers : undefined;
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      jwks: schema.jwks,
    },
  }),
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
  secret: env.BETTER_AUTH_SECRET || env.JWT_ACCESS_SECRET,
  baseURL: env.BETTER_AUTH_URL ? env.BETTER_AUTH_URL.replace(/\/api\/?$/, "") : undefined,
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://envscale.duckdns.org",
    "http://envscale.duckdns.org",
    ...(env.CORS_ORIGIN && env.CORS_ORIGIN !== "*"
      ? env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
      : []),
  ],
  socialProviders: buildSocialProviders(env),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    jwt({
      jwt: {
        secret: env.JWT_ACCESS_SECRET, // Shared secret key for Go k8s-streamer gateway HMAC verification
        expirationTime: "7d",
      },
    }),
  ],
}) as any;
