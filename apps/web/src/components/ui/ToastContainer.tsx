import { useEffect, useState } from "react";
import { Toast } from "./toast";
import { toast, type ToastItem } from "@/lib/toast";

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return toast.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });
  }, []);

  if (toasts.length === 0) return null;

  // Material Design 3: Show at most 2 snackbars concurrently to maintain focus and zero UI clutter
  const visibleToasts = toasts.slice(0, 2);
  const hiddenCount = toasts.length - visibleToasts.length;

  return (
    <aside
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col-reverse items-center gap-2 max-w-xl w-[calc(100%-2rem)] sm:w-auto pointer-events-none transition-all duration-200"
    >
      {hiddenCount > 0 && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#191B20]/95 border border-[#30343B] px-3 py-1 text-[11px] font-mono text-neutral-400 shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
          <span>+{hiddenCount} more alerts</span>
          <button
            onClick={() => toast.clear()}
            className="text-blue-400 hover:text-blue-300 font-medium ml-1 transition-colors hover:underline cursor-pointer"
          >
            Dismiss all
          </button>
        </div>
      )}

      {visibleToasts.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto w-full sm:w-auto min-w-[320px] max-w-lg transition-all duration-200 animate-in fade-in slide-in-from-bottom-3"
          onMouseEnter={() => toast.pause(item.id)}
          onMouseLeave={() => toast.resume(item.id)}
        >
          <Toast
            variant={item.variant || "default"}
            title={item.title}
            description={item.description}
            action={item.action}
            onClose={() => toast.dismiss(item.id)}
            closeable
            className="shadow-2xl backdrop-blur-xl border-[#30343B]"
          />
        </div>
      ))}
    </aside>
  );
}
