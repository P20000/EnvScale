import * as React from "react"
import { Icon } from "./Icon"
import {
  mdiCheckCircle,
  mdiAlertCircle,
  mdiAlert,
  mdiInformation,
  mdiClose,
} from "@mdi/js"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import type { ToastAction } from "@/lib/toast"

const toastVariants = cva(
  "group pointer-events-auto relative flex items-center justify-between gap-3.5 rounded-2xl border px-4 py-2.5 select-none shadow-2xl backdrop-blur-xl transition-all duration-200",
  {
    variants: {
      variant: {
        default:
          "border-[#30343B] bg-[#1E2025]/95 text-neutral-200 shadow-black/60",
        success:
          "border-emerald-500/30 bg-[#1E2025]/95 text-emerald-300 shadow-[0_8px_30px_rgba(16,185,129,0.12)]",
        error:
          "border-red-500/40 bg-[#1E2025]/95 text-red-300 shadow-[0_8px_30px_rgba(239,68,68,0.18)]",
        warning:
          "border-amber-500/30 bg-[#1E2025]/95 text-amber-300 shadow-[0_8px_30px_rgba(245,158,11,0.12)]",
        info:
          "border-blue-500/30 bg-[#1E2025]/95 text-blue-300 shadow-[0_8px_30px_rgba(59,130,246,0.12)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface ToastProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof toastVariants> {
  onClose?: () => void
  closeable?: boolean
  icon?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastAction
}

const iconMap = {
  success: mdiCheckCircle,
  error: mdiAlertCircle,
  warning: mdiAlert,
  info: mdiInformation,
  default: null,
}

const iconBadgeMap = {
  success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  error: "bg-red-500/15 text-red-400 border border-red-500/30",
  warning: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  info: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  default: "bg-neutral-800 text-neutral-300 border border-neutral-700",
}

function Toast({
  className,
  variant = "default",
  onClose,
  closeable = true,
  icon,
  title,
  description,
  action,
  children,
  ...props
}: ToastProps) {
  const iconPath =
    variant && variant !== "default"
      ? iconMap[variant as keyof typeof iconMap]
      : null

  const displayIcon =
    icon ||
    (iconPath ? <Icon path={iconPath} size={0.78} className="shrink-0" /> : null)

  const badgeStyle = iconBadgeMap[variant as keyof typeof iconBadgeMap] || iconBadgeMap.default

  return (
    <div
      data-slot="toast"
      className={cn(toastVariants({ variant }), className)}
      role="alert"
      {...props}
    >
      <div className="flex items-center gap-3 min-w-0">
        {displayIcon && (
          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-xl shadow-xs", badgeStyle)}>
            {displayIcon}
          </div>
        )}

        <div className="flex flex-col min-w-0">
          {title && (
            <div className="text-xs sm:text-[13px] font-semibold text-neutral-100 truncate tracking-tight font-heading">
              {title}
            </div>
          )}

          {description && (
            <div className="text-[11px] sm:text-xs text-neutral-400 font-normal leading-tight break-words line-clamp-2">
              {description}
            </div>
          )}

          {children && !description && (
            <div className="text-[11px] sm:text-xs text-neutral-400 font-normal leading-tight">
              {children}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-3">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 active:scale-95 transition-all font-mono"
          >
            {action.label}
          </button>
        )}

        {closeable && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-400 hover:text-neutral-100 hover:bg-white/10 outline-none transition-colors"
            aria-label="Dismiss snackbar"
          >
            <Icon path={mdiClose} size={0.65} />
          </button>
        )}
      </div>
    </div>
  )
}

/* eslint-disable-next-line react-refresh/only-export-components */
export { Toast, toastVariants }