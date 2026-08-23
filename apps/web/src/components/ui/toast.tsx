import * as React from "react"
import {
  MdClose as X,
  MdError as AlertCircle,
  MdCheckCircle as CheckCircle2,
  MdWarning as AlertTriangle,
  MdInfo as Info,
} from "react-icons/md"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between gap-4 rounded-lg border p-4 shadow-md transition-all",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        success:
          "border-status-running/30 bg-status-running/10 text-status-running",
        error:
          "border-status-error/30 bg-status-error/10 text-status-error",
        warning:
          "border-status-warning/30 bg-status-warning/10 text-status-warning",
        info: "border-primary/30 bg-primary/10 text-primary",
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
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
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
  const DefaultIcon =
    variant && variant !== "default"
      ? iconMap[variant as keyof typeof iconMap]
      : null

  const displayIcon =
    icon ||
    (DefaultIcon ? <DefaultIcon className="size-5 shrink-0" /> : null)

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
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

/* eslint-disable-next-line react-refresh/only-export-components */
export { Toast, toastVariants }