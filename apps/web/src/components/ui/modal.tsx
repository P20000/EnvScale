import * as React from "react"
import { Icon } from "./Icon"
import { mdiClose } from "@mdi/js"

import { cn } from "@/lib/utils"

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  title?: React.ReactNode
  className?: string
  contentClassName?: string
  closeButton?: boolean
  size?: "sm" | "md" | "lg"
}

const sizeClasses = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
}

function Modal({
  isOpen,
  onClose,
  children,
  title,
  className,
  contentClassName,
  closeButton = true,
  size = "md",
}: ModalProps) {
  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = "unset"
    }

    return () => {
      document.body.style.overflow = "unset"
    }
  }, [isOpen])

  React.useEffect(() => {
    if (!isOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      data-slot="modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "modal-title" : undefined}
    >
      <div
        data-slot="modal-content"
        className={cn(
          "relative flex flex-col rounded-3xl border border-neutral-800 bg-surface p-6 text-card-foreground",
          sizeClasses[size],
          contentClassName
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 id="modal-title" className="text-lg font-semibold font-heading">
              {title}
            </h2>

            {closeButton && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground transition-all hover:bg-neutral-800 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label="Close modal"
              >
                <Icon path={mdiClose} size={0.8} />
              </button>
            )}
          </div>
        )}

        {!title && closeButton && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground transition-all hover:bg-neutral-800 hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Close modal"
          >
            <Icon path={mdiClose} size={0.8} />
          </button>
        )}

        <div className={className}>{children}</div>
      </div>
    </div>
  )
}

export { Modal, type ModalProps }