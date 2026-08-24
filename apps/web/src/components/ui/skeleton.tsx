import type { HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  // Enforce explicit height mappings matching line-heights to eliminate layout shifts
  variant?: "text-xs" | "text-sm" | "text-base" | "circle" | "rect";
}

export function Skeleton({ variant = "rect", className, ...props }: SkeletonProps) {
  const variantStyles = {
    "text-xs": "h-3 rounded-sm bg-neutral-800 w-1/3",
    "text-sm": "h-3.5 rounded-sm bg-neutral-800 w-2/3",
    "text-base": "h-4 rounded-sm bg-neutral-800 w-3/4",
    "circle": "rounded-full bg-neutral-800 shrink-0",
    "rect": "rounded-2xl bg-neutral-800 w-full",
  };

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={`
        animate-pulse 
        motion-reduce:animate-none 
        ${variantStyles[variant]} 
        ${className || ""}
      `}
      {...props}
    />
  );
}
