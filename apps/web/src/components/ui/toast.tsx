import * as React from "react"
import Icon from "@mdi/react"
import {
  mdiCheckCircle,
  mdiAlertCircle,
  mdiAlert,
  mdiInformation,
  mdiClose,
} from "@mdi/js"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between gap-4 rounded-xl border p-4 transition-all",
  {
    variants: {
      variant: {
        default: "border-neutral-800 bg-surface text-foreground",
        success:
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        error:
          "border-red-500/30 bg-red-500/10 text-red-400",
        warning:
          "border-amber-500/30 bg-amber-500/10 text-amber-400",
        info: "border-blue-500/30 bg-blue-500/10 text-blue-400",
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
}

const iconMap = {
  success: mdiCheckCircle,
  error: mdiAlertCircle,
  warning: mdiAlert,
  info: mdiInformation,
  default: null,
}

function Toast({
  className,
  variant = "default",
  onClose,
  closeable = true,
  icon,
  title,
  description,
  children,
  ...props
}: ToastProps) {
  const iconPath =
    variant && variant !== "default"
      ? iconMap[variant as keyof typeof iconMap]
      : null

  const displayIcon =
    icon ||
    (iconPath ? <Icon path={iconPath} size={0.83} className="shrink-0" /> : null)

  return (
    <div
      data-slot="toast"
      className={cn(toastVariants({ variant }), className)}
      role="alert"
      {...props}
    >
      <div className="flex items-start gap-3">
        {displayIcon && (
          <div className="shrink-0 pt-0.5">{displayIcon}</div>
        )}

        <div className="flex flex-col gap-1">
          {title && <div className="text-sm font-medium">{title}</div>}

          {description && (
            <div className="text-sm opacity-90">{description}</div>
          )}

          {children && !description && (
            <div className="text-sm">{children}</div>
          )}
        </div>
      </div>

      {closeable && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md p-1 opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100"
          aria-label="Close notification"
        >
          <Icon path={mdiClose} size={0.7} />
        </button>
      )}
    </div>
  )
}

/* eslint-disable-next-line react-refresh/only-export-components */
export { Toast, toastVariants }