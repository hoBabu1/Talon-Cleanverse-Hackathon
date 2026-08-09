"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowRight, Menu, Play, X } from "lucide-react";
import { APP_ENTRY, NAV_LINKS } from "@/lib/site";
import Button from "./Button";

/** Sticky, blurred top nav — rgba(0,0,0,0.8) + backdrop blur, per the
 *  cleanverse.com/hackathon header. Mobile gets a dropdown panel. */
export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 md:px-8">
        <a href="#top" className="group flex shrink-0 items-center gap-2.5" aria-label="Talon — back to top">
          <Image
            src="/brand/talon-mark.png"
            alt="Talon logo"
            width={32}
            height={32}
            className="rounded-full border border-white/10 shadow-[0_4px_16px_rgba(248,101,28,0.25)] transition-transform duration-500 ease-out group-hover:rotate-[360deg]"
            priority
          />
          <span className="text-lg font-bold tracking-tight text-white">
            Talon
          </span>
        </a>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted transition-colors duration-200 hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-3 md:flex">
            <Button href="#demo" variant="ghost">
              <Play size={14} fill="currentColor" />
              Quick Guide
            </Button>
            <Button href={APP_ENTRY}>
              Launch App
              <ArrowRight size={15} strokeWidth={2.5} />
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-card text-white transition-colors hover:border-accent/60 md:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          className="border-t border-edge bg-ink/95 px-5 pb-6 pt-3 backdrop-blur-xl md:hidden"
          aria-label="Mobile"
        >
          <div className="flex flex-col">
            <a
              href="#demo"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b border-edge/50 py-3.5 text-sm font-semibold text-accent transition-colors hover:text-white"
            >
              <Play size={15} fill="currentColor" />
              Quick Guide
            </a>
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="border-b border-edge/50 py-3.5 text-sm font-medium text-muted transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>
          <Button
            href={APP_ENTRY}
            size="lg"
            className="mt-5 w-full"
          >
            Launch App
            <ArrowRight size={16} strokeWidth={2.5} />
          </Button>
        </nav>
      ) : null}
    </header>
  );
}
