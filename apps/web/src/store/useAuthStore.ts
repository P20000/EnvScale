import { create } from "zustand";
import { authClient } from "../lib/auth-client";
import { useTopologyStore } from "./useTopologyStore";

export interface AuthUser {
  id?: string;
  email?: string;
  name?: string;
  image?: string;
  role?: string;
}

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authModalOpen: boolean;
  authModalReason: string | null;

  openAuthModal: (reason?: string) => void;
  closeAuthModal: () => void;
  setSession: (token: string | null, user?: AuthUser | null) => void;
  checkAuth: () => Promise<boolean>;
  logout: () => Promise<void>;
  loginWithToken: (token: string, user?: AuthUser) => void;
}

function parseTokenPayload(token: string): AuthUser | null {
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return null; // Expired token
      }
      return {
        id: payload.sub || payload.id,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        image: payload.picture || payload.image || payload.avatar,
      };
    }
  } catch {
    // Malformed token payload
  }
  return null;
}

function getInitialAuthState(): { token: string | null; user: AuthUser | null; isAuthenticated: boolean } {
  if (typeof window === "undefined") {
    return { token: null, user: null, isAuthenticated: false };
  }

  const token =
    localStorage.getItem("envscale_auth_token") ||
    localStorage.getItem("envscale_access_token");

  let user: AuthUser | null = null;
  const storedUserRaw = localStorage.getItem("envscale_user");
  if (storedUserRaw) {
    try {
      user = JSON.parse(storedUserRaw);
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (token) {
    const payloadUser = parseTokenPayload(token);
    if (payloadUser) {
      user = { ...payloadUser, ...user };
      return { token, user, isAuthenticated: true };
    } else if (!storedUserRaw) {
      // Invalid/expired token with no stored user
      localStorage.removeItem("envscale_auth_token");
      localStorage.removeItem("envscale_access_token");
      return { token: null, user: null, isAuthenticated: false };
    }
    return { token, user, isAuthenticated: true };
  }

  return { token: null, user, isAuthenticated: false };
}

export const useAuthStore = create<AuthState>((set) => {
  const initial = getInitialAuthState();

  return {
    token: initial.token,
    user: initial.user,
    isAuthenticated: initial.isAuthenticated,
    isLoading: false,
    authModalOpen: false,
    authModalReason: null,

    openAuthModal: (reason?: string) => {
      set({ authModalOpen: true, authModalReason: reason || null });
    },

    closeAuthModal: () => {
      set({ authModalOpen: false, authModalReason: null });
    },

    setSession: (token, user) => {
      if (token) {
        localStorage.setItem("envscale_auth_token", token);
        if (user) {
          localStorage.setItem("envscale_user", JSON.stringify(user));
        }
        set({ token, user: user || null, isAuthenticated: true });
      } else {
        localStorage.removeItem("envscale_auth_token");
        localStorage.removeItem("envscale_access_token");
        localStorage.removeItem("envscale_user");
        set({ token: null, user: null, isAuthenticated: false });
      }
    },

    checkAuth: async () => {
      set({ isLoading: true });
      const currentToken =
        localStorage.getItem("envscale_auth_token") ||
        localStorage.getItem("envscale_access_token");

      if (currentToken) {
        const payloadUser = parseTokenPayload(currentToken);
        let storedUser: AuthUser | null = null;
        try {
          const raw = localStorage.getItem("envscale_user");
          if (raw) storedUser = JSON.parse(raw);
        } catch {
          // Ignore
        }

        const mergedUser = { ...(payloadUser || {}), ...(storedUser || {}) };
        set({
          token: currentToken,
          user: Object.keys(mergedUser).length > 0 ? mergedUser : null,
          isAuthenticated: true,
          isLoading: false,
        });
        return true;
      }

      try {
        const res = await authClient.getSession({ query: {} });
        if (res?.data?.user) {
          const u = res.data.user;
          const user: AuthUser = {
            id: u.id,
            email: u.email,
            name: u.name,
            image: u.image || undefined,
          };
          set({
            token: null,
            user,
            isAuthenticated: true,
            isLoading: false,
          });
          return true;
        }
      } catch {
        // Ignore session lookup failures
      }

      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
      return false;
    },

    loginWithToken: (token: string, user?: AuthUser) => {
      localStorage.setItem("envscale_auth_token", token);
      if (user) {
        localStorage.setItem("envscale_user", JSON.stringify(user));
      }
      set({
        token,
        user: user || parseTokenPayload(token) || null,
        isAuthenticated: true,
        authModalOpen: false,
        authModalReason: null,
      });
      useTopologyStore.getState().triggerWsReconnect();
    },

    logout: async () => {
      const streamerUrl = import.meta.env.VITE_STREAMER_BASE_URL || "http://localhost:8080";
      fetch(`${streamerUrl}/api/v1/clusters/unregister-all`, { method: "POST" }).catch(() => {});
      localStorage.removeItem("envscale_auth_token");
      localStorage.removeItem("envscale_access_token");
      localStorage.removeItem("envscale_user");
      useTopologyStore.getState().resetStore();
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        authModalOpen: false,
        authModalReason: null,
      });
      await authClient.signOut({}).catch(() => {});
    },
  };
});
