import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

const getBaseUrl = () => {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (
    typeof window !== "undefined" &&
    window.location.origin &&
    window.location.port !== "5173" &&
    window.location.port !== "5174"
  ) {
    return window.location.origin;
  }
  return "http://localhost:3000";
};

export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  plugins: [jwtClient()],
});

export const { signIn, signUp, useSession, signOut } = authClient;
