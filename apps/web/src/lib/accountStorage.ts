/**
 * Account Session Storage & Medium Detection Helpers
 * Supports multi-account session management across Google, GitHub, and Standard medium logins.
 */

export type AuthMedium = "google" | "github" | "credentials";

export interface StoredAccount {
  id: string;
  email: string;
  name: string;
  image?: string;
  role?: string;
  medium: AuthMedium;
  token: string;
  lastActive: number;
}

const SAVED_ACCOUNTS_KEY = "envscale_saved_accounts";

export function detectAuthMedium(
  user?: { email?: string; image?: string | null; medium?: AuthMedium } | null,
  fallbackMedium?: AuthMedium
): AuthMedium {
  if (user?.medium) return user.medium;
  if (typeof window !== "undefined") {
    const pending = sessionStorage.getItem("envscale_pending_auth_medium") as AuthMedium | null;
    if (pending === "google" || pending === "github" || pending === "credentials") {
      return pending;
    }
  }
  if (fallbackMedium) return fallbackMedium;
  const img = user?.image || "";
  const email = (user?.email || "").toLowerCase();
  if (
    img.includes("googleusercontent.com") ||
    img.includes("google") ||
    email.endsWith("@gmail.com")
  ) {
    return "google";
  }
  if (
    img.includes("githubusercontent.com") ||
    img.includes("github.com") ||
    img.includes("avatars.github")
  ) {
    return "github";
  }
  return "credentials";
}

export function loadSavedAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is StoredAccount => Boolean(item && item.email && item.token)
        );
      }
    }
  } catch {
    // Ignore JSON parse errors
  }
  return [];
}

export function persistSavedAccounts(accounts: StoredAccount[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage errors
  }
}

export function upsertAccountHelper(
  accounts: StoredAccount[],
  newAccount: StoredAccount
): StoredAccount[] {
  const normEmail = newAccount.email.trim().toLowerCase();
  const existingIdx = accounts.findIndex(
    (a) =>
      a.email.trim().toLowerCase() === normEmail ||
      (a.id && newAccount.id && a.id === newAccount.id)
  );

  let updated: StoredAccount[];
  if (existingIdx >= 0) {
    updated = [...accounts];
    updated[existingIdx] = {
      ...updated[existingIdx],
      ...newAccount,
      token: newAccount.token || updated[existingIdx].token,
      lastActive: Date.now(),
    };
  } else {
    updated = [newAccount, ...accounts];
  }
  persistSavedAccounts(updated);
  return updated;
}
