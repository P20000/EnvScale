import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { db } from "../db/client.js";
import { env } from "../config/env.js";

import * as schema from "../db/schema/index.js";

// Dynamically construct social providers configuration only if client credentials exist
const socialProviders: Record<string, { clientId: string; clientSecret: string; prompt?: string; accessType?: "offline" | "online" }> = {};

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    prompt: "select_account",
    accessType: "offline",
  };
}

if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
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
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://envscale.duckdns.org",
    "http://envscale.duckdns.org",
    ...(env.CORS_ORIGIN && env.CORS_ORIGIN !== "*"
      ? env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
      : []),
  ],
  socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,
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
