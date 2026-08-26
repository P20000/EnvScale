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
      if (result.token) {
        localStorage.setItem("envscale_auth_token", result.token);
      }
      setTimeout(() => {
        onLoginSuccess?.(email);
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
