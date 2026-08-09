import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { APP_ENTRY, GITHUB_URL } from "@/lib/site";
import Button from "./Button";
import Reveal from "./Reveal";
import RotatingGag from "./RotatingGag";
import VideoEmbed from "./VideoEmbed";

const CHIPS = [
  "0% entitlement forfeited (we counted)",
  "Frozen ≠ expired, on-chain",
  "Audit export your lawyer will actually like",
] as const;

const POINTS = [
  "On pay date, re-verifies every holder’s Cleanverse identity",
  "Pays compliant wallets directly",
  "Escrows the rest per-beneficiary until they re-verify",
] as const;

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Ambient glow — subtle orange wash, used sparingly per the theme. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
      />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-5 pb-16 pt-20 text-center md:px-8 md:pb-24 md:pt-28">
        <Reveal>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-edge bg-card px-4 py-1.5 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
            Live on Monad testnet · Cleanverse Build — RWA track
          </div>
        </Reveal>

        <Reveal delay={90}>
          <h1 className="mt-7 max-w-3xl text-[40px] font-extrabold leading-[1.05] tracking-[-0.02em] text-white sm:text-5xl lg:text-[56px]">
            The <span className="text-accent">transfer agent</span> for verified
            real-world assets
          </h1>
        </Reveal>

        <Reveal delay={180}>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted md:text-lg">
            Talon runs everything that happens{" "}
            <span className="text-white/90">after</span> an RWA is issued —
            coupons, dividends, redemptions.
          </p>
        </Reveal>

        <Reveal delay={220}>
          <ul className="mt-6 flex max-w-xl flex-col gap-2.5 text-left">
            {POINTS.map((point) => (
              <li
                key={point}
                className="flex items-start gap-3 text-base text-muted md:text-lg"
              >
                <Check
                  size={18}
                  strokeWidth={2.75}
                  className="mt-[5px] shrink-0 text-accent"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={260}>
          <p className="mt-6 max-w-2xl text-base font-semibold leading-relaxed text-white md:text-lg">
            No eligible holder forfeits. No ineligible holder gets paid.
          </p>
        </Reveal>

        <Reveal delay={320}>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Button href={APP_ENTRY} size="lg" className="w-full sm:w-auto">
              Launch App
              <ArrowRight size={17} strokeWidth={2.5} />
            </Button>
            <Button
              href={GITHUB_URL}
              variant="ghost"
              size="lg"
              external
              className="w-full sm:w-auto"
            >
              View on GitHub
              <ArrowUpRight size={16} strokeWidth={2.5} />
            </Button>
          </div>
        </Reveal>

        <Reveal delay={360}>
          <p className="mt-7 flex min-h-[1.5rem] max-w-xl items-center justify-center text-sm font-medium text-muted md:text-base">
            <RotatingGag />
          </p>
        </Reveal>

        <Reveal delay={400}>
          <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs font-medium text-muted">
            {CHIPS.map((chip, i) => (
              <li key={chip} className="flex items-center gap-3">
                {i > 0 ? (
                  <span aria-hidden className="h-1 w-1 rounded-full bg-edge" />
                ) : null}
                {chip}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={460} className="mt-14 w-full max-w-4xl md:mt-20">
          <div id="demo" className="scroll-mt-24">
            <VideoEmbed />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
