import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { APP_ENTRY, GITHUB_URL, HACKATHON_URL, NAV_LINKS } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="border-t border-edge">
      <div className="mx-auto w-full max-w-6xl px-5 py-14 md:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="group flex items-center gap-2.5">
              <Image
                src="/brand/talon-mark.png"
                alt="Talon logo"
                width={30}
                height={30}
                className="rounded-full border border-white/10 transition-transform duration-500 ease-out group-hover:rotate-[360deg]"
              />
              <span className="text-base font-bold tracking-tight text-white">
                Talon
              </span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
              On-chain transfer agent for Cleanverse-verified real-world assets.
              Coupons, dividends, and redemptions — paid right, even when
              eligibility drifts.
            </p>
          </div>

          <nav aria-label="Footer sections">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white">
              Explore
            </p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-sm text-muted transition-colors hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Footer resources">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white">
              Resources
            </p>
            <ul className="mt-4 flex flex-col gap-2.5">
              <li>
                <a
                  href={APP_ENTRY}
                  className="text-sm text-muted transition-colors hover:text-white"
                >
                  Launch App
                </a>
              </li>
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-white"
                >
                  GitHub
                  <ArrowUpRight size={13} />
                </a>
              </li>
              <li>
                <a
                  href={HACKATHON_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-white"
                >
                  Cleanverse Build Hackathon
                  <ArrowUpRight size={13} />
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-edge/60 pt-6 text-xs text-muted/70 md:flex-row md:items-center md:justify-between">
          <p>
            © 2026 Talon · Built by Aman Kumar for the Cleanverse Build
            Hackathon — RWA track.
          </p>
          <p>Contracts live on Monad testnet. Demo software — please don&rsquo;t YOLO your pension into it (yet).</p>
        </div>
      </div>
    </footer>
  );
}
