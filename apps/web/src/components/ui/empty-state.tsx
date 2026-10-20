import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center",
        className,
      )}
    >
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-500 [&_svg]:h-6 [&_svg]:w-6">
          {icon}
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
        {description && (
          <p className="max-w-sm text-xs leading-5 text-neutral-500">{description}</p>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}