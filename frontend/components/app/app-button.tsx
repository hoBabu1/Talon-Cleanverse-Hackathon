"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type AppButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: "primary" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
  children: ReactNode;
};

/**
 * `onClick`-capable counterpart to `components/landing/Button.tsx` — same
 * pill shape, `bg-accent`→`#ff7a38` hover, lift-on-hover, and accent focus
 * ring, so the app's write actions (Claim, Retry release, Sign & Declare,
 * Execute batch, Close action) read as the same product as the landing CTAs.
 */
const base =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0";

const variants = {
  primary:
    "bg-accent text-white shadow-[0_10px_36px_rgba(248,101,28,0.28)] hover:bg-[#ff7a38] hover:shadow-[0_14px_44px_rgba(248,101,28,0.38)]",
  ghost:
    "border border-edge bg-card/70 text-white backdrop-blur-sm hover:border-accent/60 hover:bg-card",
};

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export default function AppButton({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: AppButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 size={size === "sm" ? 12 : 14} className="animate-spin" />}
      {children}
    </button>
  );
}
