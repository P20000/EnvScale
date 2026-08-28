import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:3000",
  plugins: [jwtClient()],
});

export const { signIn, signUp, useSession, signOut } = authClient;
