import { create } from "zustand";
import { authClient } from "../lib/auth-client";
import { useTopologyStore } from "./useTopologyStore";
import { getStreamerToken, apiSwitchSession } from "../config/api";
import {
  type AuthMedium,
  type StoredAccount,
  detectAuthMedium,
  loadSavedAccounts,
  persistSavedAccounts,
  upsertAccountHelper,
} from "../lib/accountStorage";

export type { AuthMedium, StoredAccount };

export interface AuthUser {
  id?: string;
  email?: string;
  name?: string;
  image?: string;
  role?: string;
  medium?: AuthMedium;
}

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authModalOpen: boolean;
  authModalReason: string | null;
  savedAccounts: StoredAccount[];

  openAuthModal: (reason?: string) => void;
  closeAuthModal: () => void;
  setSession: (token: string | null, user?: AuthUser | null, medium?: AuthMedium) => void;
  checkAuth: () => Promise<boolean>;
  logout: () => Promise<void>;
  logoutCurrentAccount: () => Promise<void>;
  logoutAll: () => Promise<void>;
  loginWithToken: (token: string, user?: AuthUser, medium?: AuthMedium) => void;
  switchAccount: (accountId: string) => Promise<boolean>;
  removeAccount: (accountId: string) => Promise<void>;
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

function getInitialAuthState(): {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  savedAccounts: StoredAccount[];
} {
  if (typeof window === "undefined") {
    return { token: null, user: null, isAuthenticated: false, savedAccounts: [] };
  }

  const token = localStorage.getItem("envscale_auth_token") || localStorage.getItem("envscale_access_token");
  let user: AuthUser | null = null;
  try {
    const raw = localStorage.getItem("envscale_user");
    if (raw) user = JSON.parse(raw);
  } catch {
    // Ignore JSON parse errors
  }

  let savedAccounts = loadSavedAccounts();
  if (token) {
    const payloadUser = parseTokenPayload(token);
    if (payloadUser) user = { ...payloadUser, ...user };
    if (user?.email) {
      const medium = detectAuthMedium(user);
      user.medium = medium;
      const initialAcc: StoredAccount = {
        id: user.id || user.email,
        email: user.email,
        name: user.name || user.email.split("@")[0],
        image: user.image,
        role: user.role,
        medium,
        token,
        lastActive: Date.now(),
      };
      savedAccounts = upsertAccountHelper(savedAccounts, initialAcc);
    }
    return { token, user, isAuthenticated: true, savedAccounts };
  }
  return { token: null, user: null, isAuthenticated: false, savedAccounts };
}

export const useAuthStore = create<AuthState>((set, get) => {
  const initial = getInitialAuthState();

  return {
    token: initial.token,
    user: initial.user,
    isAuthenticated: initial.isAuthenticated,
    isLoading: false,
    authModalOpen: false,
    authModalReason: null,
    savedAccounts: initial.savedAccounts,

    openAuthModal: (reason?: string) => set({ authModalOpen: true, authModalReason: reason || null }),
    closeAuthModal: () => set({ authModalOpen: false, authModalReason: null }),

    setSession: (token, user, explicitMedium) => {
      if (token) {
        localStorage.setItem("envscale_auth_token", token);
        const medium = explicitMedium || detectAuthMedium(user);
        const fullUser = user ? { ...user, medium } : null;
        if (fullUser) {
          localStorage.setItem("envscale_user", JSON.stringify(fullUser));
          if (fullUser.email) {
            const acc: StoredAccount = {
              id: fullUser.id || fullUser.email,
              email: fullUser.email,
              name: fullUser.name || fullUser.email.split("@")[0],
              image: fullUser.image,
              role: fullUser.role,
              medium,
              token,
              lastActive: Date.now(),
            };
            const updated = upsertAccountHelper(get().savedAccounts, acc);
            set({ token, user: fullUser, isAuthenticated: true, savedAccounts: updated });
            return;
          }
        }
        set({ token, user: fullUser, isAuthenticated: true });
      } else {
        ["envscale_auth_token", "envscale_access_token", "envscale_user"].forEach((k) => localStorage.removeItem(k));
        set({ token: null, user: null, isAuthenticated: false });
      }
    },

    checkAuth: async () => {
      set({ isLoading: true });
      const isPendingOauth =
        typeof window !== "undefined" &&
        sessionStorage.getItem("envscale_pending_oauth") === "true";

      const currentToken =
        localStorage.getItem("envscale_auth_token") ||
        localStorage.getItem("envscale_access_token");

      // Only short-circuit on existing token if NOT returning from an active OAuth flow
      if (currentToken && !isPendingOauth) {
        let activeToken = currentToken;
        let payloadUser = parseTokenPayload(activeToken);
        let storedUser: AuthUser | null = null;
        try {
          const raw = localStorage.getItem("envscale_user");
          if (raw) storedUser = JSON.parse(raw);
        } catch {
          // Ignore
        }

        // If stored token is expired or dummy string, self-heal via switch-session
        if (!payloadUser && storedUser?.email) {
          try {
            const healed = await apiSwitchSession({
              accountId: storedUser.id,
              email: storedUser.email,
            });
            if (healed.token) {
              activeToken = healed.token;
              localStorage.setItem("envscale_auth_token", activeToken);
              localStorage.setItem("envscale_access_token", activeToken);
              payloadUser = parseTokenPayload(activeToken);
              if (healed.user) {
                storedUser = { ...storedUser, ...healed.user };
                localStorage.setItem("envscale_user", JSON.stringify(storedUser));
              }
            }
          } catch {
            // Ignore heal failure, will fallback to session check
          }
        }

        const mergedUser = { ...(payloadUser || {}), ...(storedUser || {}) };
        if (mergedUser.email && activeToken !== "session_token") {
          const medium = detectAuthMedium(mergedUser);
          mergedUser.medium = medium;
          const currentAcc: StoredAccount = {
            id: mergedUser.id || mergedUser.email,
            email: mergedUser.email,
            name: mergedUser.name || mergedUser.email.split("@")[0],
            image: mergedUser.image,
            role: mergedUser.role,
            medium,
            token: activeToken,
            lastActive: Date.now(),
          };
          const updated = upsertAccountHelper(loadSavedAccounts(), currentAcc);
          set({
            token: activeToken,
            user: mergedUser,
            isAuthenticated: true,
            isLoading: false,
            savedAccounts: updated,
          });
          return true;
        }
      }

      try {
        const res = await authClient.getSession({ query: {} });
        if (res?.data?.user) {
          const u = res.data.user;
          let activeToken = "";
          try {
            const switchRes = await apiSwitchSession({ accountId: u.id, email: u.email });
            if (switchRes.token) activeToken = switchRes.token;
          } catch {
            // Fallback to streamer-token
          }
          if (!activeToken) {
            const streamerToken = await getStreamerToken();
            if (streamerToken) activeToken = streamerToken;
          }
          if (!activeToken && currentToken && currentToken !== "session_token") {
            activeToken = currentToken;
          }
          if (activeToken) {
            localStorage.setItem("envscale_auth_token", activeToken);
            localStorage.setItem("envscale_access_token", activeToken);
          }
          const pendingMedium =
            typeof window !== "undefined"
              ? sessionStorage.getItem("envscale_pending_auth_medium")
              : null;
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("envscale_pending_auth_medium");
            sessionStorage.removeItem("envscale_pending_oauth");
          }
          const medium = detectAuthMedium(u, (pendingMedium as AuthMedium) || undefined);
          const user: AuthUser = {
            id: u.id,
            email: u.email,
            name: u.name,
            image: u.image || undefined,
            medium,
          };
          localStorage.setItem("envscale_user", JSON.stringify(user));

          const newAcc: StoredAccount = {
            id: u.id || u.email,
            email: u.email,
            name: u.name || u.email.split("@")[0],
            image: u.image || undefined,
            medium,
            token: activeToken,
            lastActive: Date.now(),
          };
          const updated = upsertAccountHelper(loadSavedAccounts(), newAcc);

          set({
            token: activeToken,
            user,
            isAuthenticated: true,
            isLoading: false,
            savedAccounts: updated,
          });
          useTopologyStore.getState().triggerWsReconnect();
          return true;
        }
      } catch (err) {
        console.error("Session lookup failed:", err);
      }

      // If pending OAuth failed or user cancelled OAuth, clean flags and restore previous account
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("envscale_pending_oauth");
        sessionStorage.removeItem("envscale_pending_auth_medium");
      }

      const saved = loadSavedAccounts();
      if (saved.length > 0) {
        const mostRecent = [...saved].sort((a, b) => b.lastActive - a.lastActive)[0];
        localStorage.setItem("envscale_auth_token", mostRecent.token);
        localStorage.setItem("envscale_access_token", mostRecent.token);
        const restoredUser: AuthUser = {
          id: mostRecent.id,
          email: mostRecent.email,
          name: mostRecent.name,
          image: mostRecent.image,
          role: mostRecent.role,
          medium: mostRecent.medium,
        };
        localStorage.setItem("envscale_user", JSON.stringify(restoredUser));
        set({
          token: mostRecent.token,
          user: restoredUser,
          isAuthenticated: true,
          isLoading: false,
          savedAccounts: saved,
        });
        useTopologyStore.getState().triggerWsReconnect();
        return true;
      }

      useTopologyStore.getState().resetStore();
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        savedAccounts: [],
      });
      return false;
    },

    loginWithToken: (token: string, user?: AuthUser, explicitMedium?: AuthMedium) => {
      localStorage.setItem("envscale_auth_token", token);
      localStorage.setItem("envscale_access_token", token);
      const parsedUser = parseTokenPayload(token);
      const medium = explicitMedium || detectAuthMedium(user || parsedUser);
      const fullUser: AuthUser = {
        ...(parsedUser || {}),
        ...(user || {}),
        medium,
      };
      if (fullUser) {
        localStorage.setItem("envscale_user", JSON.stringify(fullUser));
      }
      let updatedAccounts = loadSavedAccounts();
      if (fullUser.email) {
        const acc: StoredAccount = {
          id: fullUser.id || fullUser.email,
          email: fullUser.email,
          name: fullUser.name || fullUser.email.split("@")[0],
          image: fullUser.image,
          role: fullUser.role,
          medium,
          token,
          lastActive: Date.now(),
        };
        updatedAccounts = upsertAccountHelper(loadSavedAccounts(), acc);
      }
      set({
        token,
        user: fullUser,
        isAuthenticated: true,
        authModalOpen: false,
        authModalReason: null,
        savedAccounts: updatedAccounts,
      });
      useTopologyStore.getState().triggerWsReconnect();
    },

    switchAccount: async (accountId: string) => {
      const state = get();
      const target = state.savedAccounts.find(
        (acc) =>
          acc.id === accountId ||
          acc.email.trim().toLowerCase() === accountId.trim().toLowerCase()
      );
      if (!target) return false;

      let activeToken = target.token;
      let userData: Partial<AuthUser> = {};

      try {
        const switchRes = await apiSwitchSession({
          accountId: target.id,
          email: target.email,
        });
        if (switchRes.token) {
          activeToken = switchRes.token;
        }
        if (switchRes.user) {
          userData = switchRes.user;
        }
      } catch (err) {
        console.warn("apiSwitchSession fallback to cached credentials:", err);
      }

      if (!activeToken || activeToken === "session_token") {
        return false;
      }

      // Update active credentials in localStorage
      localStorage.setItem("envscale_auth_token", activeToken);
      localStorage.setItem("envscale_access_token", activeToken);
      const switchedUser: AuthUser = {
        id: userData.id || target.id,
        email: userData.email || target.email,
        name: userData.name || target.name,
        image: target.image,
        role: userData.role || target.role,
        medium: target.medium,
      };
      localStorage.setItem("envscale_user", JSON.stringify(switchedUser));

      // Mark target account as latest active with the valid token
      const updatedAccounts = state.savedAccounts.map((acc) =>
        acc.email.trim().toLowerCase() === target.email.trim().toLowerCase()
          ? {
              ...acc,
              id: switchedUser.id || acc.id,
              name: switchedUser.name || acc.name,
              token: activeToken,
              lastActive: Date.now(),
            }
          : acc
      );
      persistSavedAccounts(updatedAccounts);

      // Reset active cluster topology and force WS reconnect
      useTopologyStore.getState().resetStore();
      set({
        token: activeToken,
        user: switchedUser,
        isAuthenticated: true,
        savedAccounts: updatedAccounts,
      });
      useTopologyStore.getState().triggerWsReconnect();
      return true;
    },

    removeAccount: async (accountId: string) => {
      const state = get();
      const updated = state.savedAccounts.filter(
        (acc) =>
          acc.id !== accountId &&
          acc.email.trim().toLowerCase() !== accountId.trim().toLowerCase()
      );
      persistSavedAccounts(updated);
      set({ savedAccounts: updated });

      const currentEmail = state.user?.email?.trim().toLowerCase();
      if (currentEmail && currentEmail === accountId.trim().toLowerCase()) {
        if (updated.length > 0) {
          const nextAccount = [...updated].sort((a, b) => b.lastActive - a.lastActive)[0];
          await get().switchAccount(nextAccount.id || nextAccount.email);
        } else {
          await get().logout();
        }
      }
    },

    logoutCurrentAccount: async () => {
      const state = get();
      if (state.user?.email) {
        await get().removeAccount(state.user.email);
      } else {
        await get().logout();
      }
    },

    logoutAll: async () => {
      const streamerUrl = import.meta.env.VITE_STREAMER_BASE_URL || "http://localhost:8080";
      fetch(`${streamerUrl}/api/v1/clusters/unregister-all`, { method: "POST" }).catch(() => {});
      ["envscale_auth_token", "envscale_access_token", "envscale_user", "envscale_saved_accounts", "envscale-topology-storage-v2"].forEach((k) => localStorage.removeItem(k));
      useTopologyStore.getState().resetStore();
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        authModalOpen: false,
        authModalReason: null,
        savedAccounts: [],
      });
      await authClient.signOut({}).catch(() => {});
    },

    logout: async () => {
      await get().logoutAll();
    },
  };
});
