import { useState } from "react";
import { Icon } from "../ui/Icon";
import {
  mdiArrowLeft,
  mdiEmail,
  mdiLock,
  mdiAccount,
  mdiAlertCircle,
  mdiCheckCircle,
  mdiLoading,
} from "@mdi/js";
import { apiLogin, apiRegister } from "../../config/api";
import { authClient } from "../../lib/auth-client";
import { useAuthStore } from "../../store/useAuthStore";
import { EnvScaleLogo } from "../ui/EnvScaleLogo";

interface AuthBufferPageProps {
  onBackToLanding: () => void;
  onLoginSuccess?: () => void;
}

export function AuthBufferPage({ onBackToLanding, onLoginSuccess }: AuthBufferPageProps) {
  const loginWithToken = useAuthStore((s) => s.loginWithToken);

  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      setError(null);
      sessionStorage.setItem("envscale_pending_auth_medium", "google");
      sessionStorage.setItem("envscale_pending_oauth", "true");
      await authClient.signOut({}).catch(() => {});
      localStorage.removeItem("envscale_auth_token");
      localStorage.removeItem("envscale_access_token");
      const res = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
      if (res?.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      if (res?.error) {
        setError(res.error.message || "Google OAuth is not configured on the server.");
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || "Google OAuth authentication failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGithubLogin = async () => {
    try {
      setIsLoading(true);
      setError(null);
      sessionStorage.setItem("envscale_pending_auth_medium", "github");
      sessionStorage.setItem("envscale_pending_oauth", "true");
      await authClient.signOut({}).catch(() => {});
      localStorage.removeItem("envscale_auth_token");
      localStorage.removeItem("envscale_access_token");
      const res = await authClient.signIn.social({
        provider: "github",
        callbackURL: window.location.origin,
      });
      if (res?.data?.url) {
        window.location.href = res.data.url;
        return;
      }
      if (res?.error) {
        setError(res.error.message || "GitHub OAuth is not configured on the server.");
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || "GitHub OAuth authentication failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Please provide both email and password.");
      return;
    }
    if (mode === "register" && !name.trim()) {
      setError("Please provide your full name.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const result =
      mode === "register"
        ? await apiRegister({ name: name.trim(), email: email.trim(), password })
        : await apiLogin({ email: email.trim(), password });

    setIsLoading(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccessMsg(
        mode === "register" ? "Account created successfully!" : "Authenticated successfully!"
      );
      const jwt = result.accessToken || result.token;
      if (jwt) {
        loginWithToken(jwt, result.user, "credentials");
      }
      setTimeout(() => {
        onLoginSuccess?.();
      }, 500);
    }
  };

  return (
    <div className="relative min-h-screen w-screen flex items-center justify-center bg-[#111318] px-4 py-12 select-none overflow-hidden">
      {/* Background Ambience Grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: "radial-gradient(#2B2F36 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Top Left Return Button */}
      <div className="absolute top-6 left-6 z-20">
        <button
          onClick={onBackToLanding}
          className="flex items-center gap-2 rounded-md border border-[#30343B] bg-[#191B20] px-3.5 py-2 text-xs font-medium text-[#C4C7C5] hover:bg-[#23262D] hover:text-[#E6E1E5] transition-colors"
        >
          <Icon path={mdiArrowLeft} size={0.65} />
          <span>Back to Overview</span>
        </button>
      </div>

      {/* Centered Buffer Auth Card */}
      <div className="w-full max-w-md rounded-2xl border border-[#30343B] bg-[#191B20] p-6 sm:p-8 space-y-6 shadow-2xl relative z-10">
        {/* Header Branding */}
        <div className="flex items-center gap-3 border-b border-[#30343B] pb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#A8C7FA] text-[#102F50] shrink-0 shadow-md">
            <EnvScaleLogo className="h-5 w-5 text-[#102F50]" />
          </div>
          <div>
            <h1 className="text-base font-bold text-[#E6E1E5] font-heading tracking-tight">
              {mode === "signin" ? "Sign In to EnvScale" : "Create EnvScale Account"}
            </h1>
            <p className="text-xs text-[#92959D]">
              {mode === "signin"
                ? "Authenticate to access your Kubernetes cluster telemetry"
                : "Register a workspace to start monitoring workloads"}
            </p>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="rounded-md border border-[#F2B8B5]/40 bg-[#410E0B]/20 p-3 text-xs text-[#F2B8B5] flex items-center gap-2 font-mono">
            <Icon path={mdiAlertCircle} size={0.65} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Success Notification */}
        {successMsg && (
          <div className="rounded-md border border-[#6DD6A8]/40 bg-[#6DD6A8]/10 p-3 text-xs text-[#6DD6A8] flex items-center gap-2 font-mono">
            <Icon path={mdiCheckCircle} size={0.65} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Mode Toggle: Sign In vs Register (Signature Blue background with Dark Text) */}
        <div className="flex rounded-md bg-[#111318] p-1 border border-[#30343B] text-xs font-medium">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
            }}
            className={`flex-1 rounded py-1.5 transition-all text-xs font-bold ${
              mode === "signin"
                ? "bg-[#A8C7FA] text-[#102F50] shadow-sm"
                : "text-[#92959D] hover:text-[#E6E1E5]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={`flex-1 rounded py-1.5 transition-all text-xs font-bold ${
              mode === "register"
                ? "bg-[#A8C7FA] text-[#102F50] shadow-sm"
                : "text-[#92959D] hover:text-[#E6E1E5]"
            }`}
          >
            Register
          </button>
        </div>

        {/* Social Authentication Channels */}
        <div className="space-y-2.5">
          {/* Google Login Channel */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2.5 rounded-md border border-[#30343B] bg-[#111318] hover:bg-[#23262D] py-2.5 text-xs font-medium text-[#E6E1E5] transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
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
            <span>Continue with Google</span>
          </button>

          {/* GitHub Login Channel */}
          <button
            type="button"
            onClick={handleGithubLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2.5 rounded-md border border-[#30343B] bg-[#111318] hover:bg-[#23262D] py-2.5 text-xs font-medium text-[#E6E1E5] transition-colors disabled:opacity-50"
          >
            <svg className="h-4 w-4 shrink-0 fill-current text-white" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>Continue with GitHub</span>
          </button>
        </div>

        {/* Centered Divider for Credentials Section */}
        <div className="relative flex items-center justify-center my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#30343B]" />
          </div>
          <span className="relative bg-[#191B20] px-3 text-[10px] uppercase tracking-wider text-[#92959D] font-mono select-none">
            Or continue with credentials
          </span>
        </div>

        {/* Authentication Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#C4C7C5] flex items-center gap-1.5">
                <Icon path={mdiAccount} size={0.6} className="text-[#92959D]" />
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DevOps Lead"
                required={mode === "register"}
                className="w-full rounded-md border border-[#30343B] bg-[#111318] px-3.5 py-2 text-xs font-mono text-[#E6E1E5] placeholder-[#5C616B] focus:border-[#A8C7FA] focus:outline-none transition-colors"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#C4C7C5] flex items-center gap-1.5">
              <Icon path={mdiEmail} size={0.6} className="text-[#92959D]" />
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="engineer@company.internal"
              required
              className="w-full rounded-md border border-[#30343B] bg-[#111318] px-3.5 py-2 text-xs font-mono text-[#E6E1E5] placeholder-[#5C616B] focus:border-[#A8C7FA] focus:outline-none transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#C4C7C5] flex items-center gap-1.5">
              <Icon path={mdiLock} size={0.6} className="text-[#92959D]" />
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              className="w-full rounded-md border border-[#30343B] bg-[#111318] px-3.5 py-2 text-xs font-mono text-[#E6E1E5] placeholder-[#5C616B] focus:border-[#A8C7FA] focus:outline-none transition-colors"
            />
          </div>

          {/* Submit Action: Signature Blue Background with Dark Navy Text */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-[#A8C7FA] px-4 py-2.5 text-xs font-bold text-[#102F50] hover:bg-[#D3E3FD] transition-colors disabled:opacity-50 mt-2 shadow-md cursor-pointer"
          >
            {isLoading && <Icon path={mdiLoading} size={0.65} className="animate-spin text-[#102F50]" />}
            <span>
              {isLoading
                ? mode === "register"
                  ? "Creating Account..."
                  : "Authenticating..."
                : mode === "register"
                ? "Create Account & Enter Dashboard"
                : "Sign In & Enter Dashboard"}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
}
