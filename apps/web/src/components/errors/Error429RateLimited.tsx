import { Timer, X } from "lucide-react";
import { useErrorStore } from "../../store/useErrorStore";

export function Error429RateLimited() {
  const rateLimitSeconds = useErrorStore((s) => s.rateLimitSeconds);
  const clearError = useErrorStore((s) => s.clearError);

  if (rateLimitSeconds === null) return null;

  return (
    <aside
      aria-label="Rate limit alert"
      className="fixed top-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-full border border-amber-500/40 bg-[#191B20]/95 px-5 py-2.5 text-xs text-neutral-200 shadow-2xl backdrop-blur-md animate-in slide-in-from-top-4"
    >
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
        <Timer className="h-3.5 w-3.5 animate-spin" />
      </div>

      <div className="flex items-center gap-2">
        <span className="font-semibold text-amber-300">Rate Limit Exceeded</span>
        <span className="text-neutral-400">•</span>
        <span className="text-neutral-300">
          Requests paused for cooling down:
        </span>
        <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
          {rateLimitSeconds}s
        </span>
      </div>

      <button
        type="button"
        onClick={clearError}
        className="ml-1 rounded-full p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
        title="Dismiss rate limit alert"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </aside>
  );
}
