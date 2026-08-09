"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  /** Stagger delay in ms — maps to the CSS `--reveal-delay` transition-delay. */
  delay?: number;
  className?: string;
};

/**
 * Scroll-triggered reveal: opacity 0→1, translateY 20px→0, once.
 * The exact restrained pattern used across cleanverse.com's marketing pages.
 * Toggles the `is-visible` class directly on the node (no re-render).
 * Reduced-motion and no-JS fallbacks are handled in globals.css.
 */
export default function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!("IntersectionObserver" in window)) {
      el.classList.add("is-visible");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={["reveal", className].filter(Boolean).join(" ")}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
