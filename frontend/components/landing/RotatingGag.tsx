"use client";

import { useEffect, useState } from "react";

/**
 * A single rotating one-liner that cycles through the funnier ways of saying
 * "we don't lose people's money." Keeps the hero human without touching the
 * serious pitch copy above it. Respects prefers-reduced-motion: if the user
 * asked for less movement, we just show the first line and stop.
 */
const GAGS = [
  "Your coupon survived a compliance freeze. You did not have to.",
  "Nobody's dividend gets “accidentally” refunded to the issuer here.",
  "Escrow so polite it holds your money AND your spot in line.",
  "We read the revert bytes so your lawyer doesn't have to.",
  "Frozen holder? Cool. The money's still yours. Chill — literally.",
  "Zero forfeited. Zero. We checked. Then we fuzz-tested the checking.",
] as const;

export default function RotatingGag() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((v) => (v + 1) % GAGS.length), 3600);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      key={i}
      className="inline-block animate-gag-in text-white/90"
    >
      {GAGS[i]}
    </span>
  );
}
