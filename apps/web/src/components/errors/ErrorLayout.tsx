import React from "react";
import { cn } from "@/lib/utils";

export interface ErrorLayoutProps {
  statusCode: number | string;
  badgeText?: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accentColor?: "red" | "amber" | "blue" | "purple" | "cyan";
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function ErrorLayout({
  statusCode,
  badgeText,
  title,
  description,
  icon,
  accentColor = "amber",
  children,
  actions,
  className,
}: ErrorLayoutProps) {
  const accentStyles = {
    red: {
      border: "border-red-500/25",
      glow: "from-red-500/10 via-transparent to-transparent",
      iconBg: "bg-red-500/10 border-red-500/30 text-red-400",
      badge: "bg-red-500/10 border-red-500/30 text-red-400",
    },
    amber: {
      border: "border-amber-500/25",
      glow: "from-amber-500/10 via-transparent to-transparent",
      iconBg: "bg-amber-500/10 border-amber-500/30 text-amber-400",
      badge: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    },
    blue: {
      border: "border-blue-500/25",
      glow: "from-blue-500/10 via-transparent to-transparent",
      iconBg: "bg-blue-500/10 border-blue-500/30 text-blue-400",
      badge: "bg-blue-500/10 border-blue-500/30 text-blue-400",
    },
    cyan: {
      border: "border-cyan-500/25",
      glow: "from-cyan-500/10 via-transparent to-transparent",
      iconBg: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400",
      badge: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400",
    },
    purple: {
      border: "border-purple-500/25",
      glow: "from-purple-500/10 via-transparent to-transparent",
      iconBg: "bg-purple-500/10 border-purple-500/30 text-purple-400",
      badge: "bg-purple-500/10 border-purple-500/30 text-purple-400",
    },
  }[accentColor];

  return (
    <div className="relative flex min-h-screen w-screen items-center justify-center overflow-hidden bg-[#111318] px-4 py-8 font-sans text-[#E6E1E5]">
      {/* Dynamic ambient background glow */}
      <div
        className={cn(
          "pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-radial blur-3xl opacity-40",
          accentStyles.glow
        )}
      />

      <section
        role="alert"
        aria-labelledby="error-layout-title"
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col items-center gap-6 rounded-2xl border bg-[#191B20]/90 p-8 text-center shadow-2xl backdrop-blur-md",
          accentStyles.border,
          className
        )}
      >
        {/* Status Code & Pill */}
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight text-neutral-300">
            {statusCode}
          </span>
          {badgeText && (
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                accentStyles.badge
              )}
            >
              {badgeText}
            </span>
          )}
        </div>

        {/* Central Icon Avatar */}
        <div
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-2xl border shadow-inner",
            accentStyles.iconBg
          )}
        >
          {icon}
        </div>

        {/* Headline & Description */}
        <div className="space-y-2">
          <h1 id="error-layout-title" className="text-xl font-bold text-neutral-100">
            {title}
          </h1>
          <p className="text-sm leading-relaxed text-neutral-400 max-w-md">
            {description}
          </p>
        </div>

        {/* Custom Contextual Body (Accounts, Diagnostics, Progress) */}
        {children && <div className="w-full text-left">{children}</div>}

        {/* Action Controls */}
        {actions && (
          <div className="flex w-full flex-wrap items-center justify-center gap-3 pt-2">
            {actions}
          </div>
        )}
      </section>
    </div>
  );
}
