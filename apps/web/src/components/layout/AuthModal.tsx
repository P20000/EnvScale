import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiClose,
  mdiLock,
  mdiEmail,
  mdiAlertCircle,
  mdiCheckCircle,
  mdiLoading,
} from "@mdi/js";
import { apiLogin } from "../../config/api";
import { authClient } from "../../lib/auth-client";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: (userEmail: string) => void;
}

export function AuthModal({ isOpen, onClose, onLoginSuccess }: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please provide both email and password.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const result = await apiLogin({ email, password });
    setIsLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccessMsg("Authenticated successfully!");
      // API server returns the field as 'accessToken', not 'token'
      const jwt = result.accessToken || result.token;
      if (jwt) {
        localStorage.setItem("envscale_auth_token", jwt);
      }
      setTimeout(() => {
        onLoginSuccess?.(email); // token already in localStorage before this fires
        onClose();
        setSuccessMsg(null);
        setPassword("");
      }, 800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-3xl border border-neutral-800 bg-surface p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <EnvScaleLogo className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-100 font-heading">EnvScale Authentication</h3>
              <p className="text-xs text-neutral-400">Sign in to your team workspace</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
          >
            <Icon path={mdiClose} size={0.7} />
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-400 flex items-center gap-2">
            <Icon path={mdiAlertCircle} size={0.65} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-400 flex items-center gap-2">
            <Icon path={mdiCheckCircle} size={0.65} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await authClient.signIn.social({ provider: "google", callbackURL: window.location.origin });
                if (res?.error) {
                  setError(res.error.message || "Google OAuth is not configured on the server. Please set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET in apps/api-server/.env");
                }
              } catch (err: unknown) {
                setError((err as Error)?.message || "Google OAuth authentication failed.");
              }
            }}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-neutral-800 bg-background py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Sign in with Google</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                const res = await authClient.signIn.social({ provider: "github", callbackURL: window.location.origin });
                if (res?.error) {
                  setError(res.error.message || "GitHub OAuth is not configured on the server. Please set GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET in apps/api-server/.env");
                }
              } catch (err: unknown) {
                setError((err as Error)?.message || "GitHub OAuth authentication failed.");
              }
            }}
            className="w-full flex items-center justify-center gap-2 rounded-md border border-neutral-800 bg-background py-2 text-xs font-medium text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <svg className="h-4 w-4 fill-current text-white" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>Sign in with GitHub</span>
          </button>
        </div>

        <div className="relative flex items-center justify-center my-2">
          <div className="border-t border-neutral-800 w-full"></div>
          <span className="bg-surface px-2 text-[10px] uppercase tracking-wider text-neutral-500 font-heading">
            Or continue with email
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5 font-heading">
              <Icon path={mdiEmail} size={0.6} className="text-neutral-400" />
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="developer@company.io"
              required
              className="w-full rounded-sm border border-neutral-800 bg-background px-3.5 py-2.5 text-xs font-mono text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-300 flex items-center gap-1.5 font-heading">
              <Icon path={mdiLock} size={0.6} className="text-neutral-400" />
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full rounded-sm border border-neutral-800 bg-background px-3.5 py-2.5 text-xs font-mono text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-800 bg-background px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-md bg-blue-500 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {isLoading && <Icon path={mdiLoading} size={0.65} className="animate-spin" />}
              <span>{isLoading ? "Authenticating..." : "Sign In"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
