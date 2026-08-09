"use client";

import { useEffect, type ReactNode } from "react";
import Lenis from "lenis";

/**
 * Buttery inertial scrolling (Lenis) for the landing page.
 * - `autoRaf` drives Lenis' internal rAF loop.
 * - `anchors` intercepts in-page #anchor clicks and glides to them,
 *   with an offset that clears the 64px sticky nav.
 * - Skipped entirely under prefers-reduced-motion (native scrolling stays).
 */
export default function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.11,
      anchors: { offset: -88 },
    });

    return () => {
      lenis.destroy();
    };
  }, []);

  return <>{children}</>;
}
