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

  return (
    <aside
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((item) => (
        <div key={item.id} className="pointer-events-auto transition-all duration-200">
          <Toast
            variant={item.variant || "default"}
            title={item.title}
            description={item.description}
            onClose={() => toast.dismiss(item.id)}
            closeable
            className="shadow-2xl backdrop-blur-md bg-[#191B20]/95 border-[#30343B]"
          />
        </div>
      ))}
    </aside>
  );
}
