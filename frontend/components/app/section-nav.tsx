"use client";

import { useEffect, useState } from "react";

export type Section = { id: string; label: string };

/**
 * Sticky right-rail scroll-spy — jump between page sections without scrolling,
 * with the current section highlighted via IntersectionObserver. Desktop (xl+)
 * only; smaller screens just scroll normally.
 */
export function SectionNav({ sections }: { sections: Section[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections]);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (sections.length === 0) return null;

  return (
    <nav className="fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end gap-1.5 xl:flex print:!hidden" aria-label="On this page">
      {sections.map((s) => {
        const on = active === s.id;
        return (
          <button key={s.id} type="button" onClick={() => jump(s.id)} className="group flex items-center gap-2">
            <span className={`text-xs font-medium transition-all ${on ? "text-accent" : "text-muted/50 opacity-0 group-hover:opacity-100"}`}>
              {s.label}
            </span>
            <span className={`h-2 w-2 rounded-full transition-colors ${on ? "bg-accent" : "bg-edge group-hover:bg-muted"}`} />
          </button>
        );
      })}
    </nav>
  );
}
