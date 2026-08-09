import Link from "next/link";
import type { ReactNode } from "react";

type ButtonProps = {
  href: string;
  variant?: "primary" | "ghost";
  size?: "md" | "lg";
  external?: boolean;
  children: ReactNode;
  className?: string;
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const variants = {
  primary:
    "bg-accent text-white shadow-[0_10px_36px_rgba(248,101,28,0.28)] hover:bg-[#ff7a38] hover:shadow-[0_14px_44px_rgba(248,101,28,0.38)]",
  ghost:
    "border border-edge bg-card/70 text-white backdrop-blur-sm hover:border-accent/60 hover:bg-card",
};

const sizes = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-sm md:text-base",
};

/** Pill-shaped CTA in the cleanverse.com style. Renders Next Link for
 *  internal routes, a plain anchor for external URLs and #anchors. */
export default function Button({
  href,
  variant = "primary",
  size = "md",
  external = false,
  children,
  className = "",
}: ButtonProps) {
  const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  if (href.startsWith("#")) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
