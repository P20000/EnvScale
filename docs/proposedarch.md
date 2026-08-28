Here is the architectural execution plan to integrate **Better Auth** with GitHub and Google OAuth, Drizzle ORM, and your existing Go WebSocket streamer (`k8s-streamer`).

---

### System Architecture Overview

```
                               ┌────────────────────────────────────────────────────────┐
                               │                    Client (React)                      │
                               └─────────┬──────────────────────────────────┬───────────┘
                                         │                                  │
                  1. OAuth Login / Flow  │            2. Get JWT for WS     │ 3. Connect WS with JWT
                 (Google / GitHub / PW)  │            (Bearer / Cookie)     │ (?token=<jwt>)
                                         ▼                                  ▼
                               ┌───────────────────┐             ┌────────────────────┐
                               │    api-server     │             │    k8s-streamer    │
                               │  (Express + Node) │             │    (Go Gateway)    │
                               └─────────┬─────────┘             └──────────┬─────────┘
                                         │                                  │
                                4. Query │ Drizzle Adapter                  │ 5. Validate HMAC
                                         ▼                                  ▼
                               ┌───────────────────┐             ┌────────────────────┐
                               │    PostgreSQL     │             │   Shared Secret    │
                               │   (Auth Tables)   │             │ (JWT_ACCESS_SECRET)│
                               └───────────────────┘             └────────────────────┘

```

---

### Step 1: Install Better Auth Dependencies

In `apps/api-server`:

```bash
npm --prefix apps/api-server i better-auth @better-auth/cli

```

In `apps/web`:

```bash
npm --prefix apps/web i better-auth

```

---

### Step 2: Drizzle Schema Migration for Better Auth

Better Auth requires standard core tables (`user`, `session`, `account`, `verification`). We map these to your existing `UUID` conventions and foreign keys.

Create `apps/api-server/src/db/schema/auth.ts`:

```typescript
import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  role: text("role").default("user").notNull(), // 'user' | 'admin'
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(), // 'google' | 'github' | 'credential'
  userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"), // For local password fallback
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

```

---

### Step 3: Configure Better Auth Instance with JWT Plugin

To ensure your Go streamer (`k8s-streamer`) can continue validating WebSocket connections via HMAC-SHA256, configure the **JWT Plugin** in Better Auth so it signs tokens with your existing `JWT_ACCESS_SECRET`.

Create `apps/api-server/src/lib/auth.ts`:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { db } from "../db";
import * as schema from "../db/schema/auth";
import { env } from "../config/env";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL, // e.g., http://localhost:5000
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  plugins: [
    jwt({
      jwt: {
        secret: env.JWT_ACCESS_SECRET, // Shared with Go streamer
        expirationTime: "15m",
      },
    }),
  ],
});

```

---

### Step 4: Mount Handlers & Express Middleware

In `apps/api-server/src/index.ts`:

```typescript
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth";

// Mount Better Auth handler (handles /api/auth/* routes automatically)
app.all("/api/auth/*", toNodeHandler(auth));

// Express route protection helper
export const requireAuth = async (req, res, next) => {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = session.user;
  req.session = session.session;
  next();
};

```

---

### Step 5: Frontend Auth Client & WebSocket Bridge

In `apps/web/src/lib/auth-client.ts`:

```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
});

export const { signIn, signUp, useSession, signOut } = authClient;

```

#### Updated WebSocket Connection Hook (`useK8sStream.ts`)

To stream live cluster telemetry, the frontend requests a fresh JWT from Better Auth before opening the socket:

```typescript
// Fetch JWT signed by Better Auth plugin
const { data } = await authClient.token();
const jwtToken = data?.token;

// Connect to Go streamer using the token
const wsUrl = `${STREAMER_WS_URL}?clusterId=${clusterId}&token=${jwtToken}`;
const socket = new WebSocket(wsUrl);

```

---

### Step 6: Environment Variables Setup

Add the following credentials to `apps/api-server/.env`:

```env
# Better Auth Core
BETTER_AUTH_SECRET=your-random-32-character-secret
BETTER_AUTH_URL=http://localhost:5000

# Shared JWT secret for Go WebSocket Streamer
JWT_ACCESS_SECRET=replace-with-a-long-random-access-secret

# Google OAuth (From Google Cloud Console)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

# GitHub OAuth (From GitHub Developer Settings)
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

```

---

### Benefits of This Architecture

* **Zero Changes Needed on Go Gateway:** `k8s-streamer` continues using `auth.go` to verify incoming WebSocket tokens against `JWT_ACCESS_SECRET` via HMAC-SHA256.


* **No Database Calls on WebSocket Messages:** The Go streamer remains stateless, high-throughput, and decoupled from PostgreSQL.


* **Standardized OAuth:** Google and GitHub login, session rotation, and password fallback work out of the box with zero custom token plumbing.