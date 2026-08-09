"use client";

import {
  Banknote,
  ClipboardCheck,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, type CSSProperties } from "react";

/**
 * The eligibility-drift flowchart from slide 1 of the pitch deck, ported to the
 * landing page's dark theme: record date → pass lapses → pay date → a fork into
 * two unacceptable outcomes → Talon's resolution.
 *
 * Motion is self-contained rather than wrapped in <Reveal> because the arrows
 * need a stroke-dash *draw* (not a fade+slide), and the whole figure has to
 * animate as one staggered sequence off a single trigger. One IntersectionObserver
 * puts `dd-in` on the root; every animated child carries its own `--d` delay.
 * Reduced-motion and no-JS fallbacks live in globals.css alongside `.reveal`.
 */

type Step = {
  kicker: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  hot?: boolean;
};

const STEPS: readonly Step[] = [
  {
    kicker: "Step 01",
    title: "Record date",
    body: "Holder is verified and fully entitled to the payout.",
    Icon: ClipboardCheck,
  },
  {
    kicker: "Step 02",
    title: "Pass lapses",
    body: "Frozen or expired mid-flight — not the holder's fault.",
    Icon: ShieldX,
    hot: true,
  },
  {
    kicker: "Step 03",
    title: "Pay date",
    body: "The payout is due — and the issuer is trapped.",
    Icon: Banknote,
  },
] as const;

/** Full class strings, never interpolated fragments — Tailwind scans literals. */
const OUTCOMES = [
  {
    title: "Pay them anyway",
    body: "You just paid an unverified party — a direct compliance violation the issuer personally answers for.",
    emphasis: "unverified party",
    verdict: "Regulatory breach",
    card: "border-red-400/30 bg-red-400/[0.06]",
    mark: "bg-red-500 text-white",
    heading: "text-red-400",
    verdictTone: "text-red-400/90",
  },
  {
    title: "Withhold it",
    body: "You seized value they earned while fully verified. That's confiscation — and it breaks trust in the asset.",
    emphasis: "earned while fully verified",
    verdict: "Theft of entitlement",
    card: "border-amber-300/30 bg-amber-300/[0.06]",
    mark: "bg-amber-400 text-ink",
    heading: "text-amber-300",
    verdictTone: "text-amber-300/90",
  },
] as const;

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

/** Connector between two steps: horizontal on desktop, vertical when stacked. */
function Connector({ dash, head }: { dash: number; head: number }) {
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: "none",
  } as const;

  return (
    <div
      aria-hidden
      className="flex items-center justify-center py-3 text-white/60 md:px-2 md:py-0 lg:px-3"
    >
      <svg className="md:hidden" width="14" height="36" viewBox="0 0 14 36">
        <path className="dd-dash" style={d(dash)} pathLength={1} d="M7 2v26" {...stroke} />
        <path className="dd-item" style={d(head)} d="M3 26l4 5 4-5" {...stroke} />
      </svg>
      <svg className="hidden md:block" width="40" height="14" viewBox="0 0 40 14">
        <path className="dd-dash" style={d(dash)} pathLength={1} d="M2 7h30" {...stroke} />
        <path className="dd-item" style={d(head)} d="M29 3l5 4-5 4" {...stroke} />
      </svg>
    </div>
  );
}

export default function DriftDiagram() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (!("IntersectionObserver" in window)) {
      el.classList.add("dd-in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          entry.target.classList.add("dd-in");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="mx-auto mt-14 w-full max-w-5xl md:mt-16">
      {/* ── The timeline: three steps, arrows between ── */}
      <div className="grid md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {STEPS.map(({ kicker, title, body, Icon, hot }, i) => (
          <Fragment key={kicker}>
            {i > 0 ? <Connector dash={i * 200 - 80} head={i * 200 + 20} /> : null}
            <div
              style={d(i * 200)}
              className={[
                "dd-item relative h-full rounded-card border p-5 transition-colors duration-300 md:p-6",
                hot
                  ? "border-red-400/35 bg-red-400/[0.06] shadow-[0_10px_40px_-18px_rgba(248,113,113,0.55)]"
                  : "border-edge bg-card hover:border-white/20",
              ].join(" ")}
            >
              {hot ? (
                <span className="absolute -top-3 left-5 inline-flex items-center gap-1.5 rounded-md bg-red-500 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_4px_14px_rgba(239,68,68,0.4)]">
                  <TriangleAlert size={11} />
                  Eligibility drift
                </span>
              ) : null}

              <span
                className={[
                  "flex h-11 w-11 items-center justify-center rounded-xl border",
                  hot
                    ? "border-red-400/30 bg-red-400/10 text-red-400"
                    : "border-edge bg-white/[0.04] text-white/55",
                ].join(" ")}
              >
                <Icon size={20} />
              </span>

              <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                {kicker}
              </p>
              <h3
                className={[
                  "mt-1.5 text-lg font-bold tracking-tight",
                  hot ? "text-red-400" : "text-white",
                ].join(" ")}
              >
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          </Fragment>
        ))}
      </div>

      {/* ── The fork: trunk, verdict pill, then two branches ── */}
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          style={d(540)}
          className="dd-item block h-8 w-px origin-top bg-white/35"
        />

        <span
          style={d(580)}
          className="dd-item inline-flex items-center gap-2 rounded-full border border-red-400/25 bg-red-400/[0.07] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300"
        >
          <TriangleAlert size={12} />
          Two bad options
        </span>

        {/* Stacked layout: one line straight down into the first card. */}
        <span
          aria-hidden
          style={d(640)}
          className="dd-item block h-8 w-px bg-white/35 md:hidden"
        />

        {/* Wide layout: rounded split pointing at each card's centre. */}
        <div aria-hidden style={d(640)} className="dd-item relative hidden h-12 w-full md:block">
          <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-white/35" />
          <span className="absolute bottom-1 left-1/4 right-1/2 top-4 rounded-tl-xl border-l border-t border-white/35" />
          <span className="absolute bottom-1 left-1/2 right-1/4 top-4 rounded-tr-xl border-r border-t border-white/35" />
          <span className="absolute bottom-0 left-1/4 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent border-t-white/60" />
          <span className="absolute bottom-0 right-1/4 translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent border-t-white/60" />
        </div>
      </div>

      {/* ── The two unacceptable outcomes ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {OUTCOMES.map((o, i) => {
          const [before, after] = o.body.split(o.emphasis);
          return (
            <div
              key={o.title}
              style={d(720 + i * 100)}
              className={`dd-item h-full rounded-card border p-5 md:p-6 ${o.card}`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${o.mark}`}
                >
                  <X size={13} strokeWidth={3} />
                </span>
                <h3 className={`text-base font-bold tracking-tight md:text-lg ${o.heading}`}>
                  {o.title}
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {before}
                <span className="font-semibold text-white">{o.emphasis}</span>
                {after}
              </p>
              <p
                className={`mt-3.5 border-t border-white/10 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] ${o.verdictTone}`}
              >
                {o.verdict}
              </p>
            </div>
          );
        })}
      </div>

      {/* ── Talon's resolution ── */}
      <div
        style={d(920)}
        className="dd-item mt-4 flex flex-col items-start gap-4 rounded-card border border-l-[3px] border-accent/30 border-l-accent bg-gradient-to-r from-accent/[0.10] via-accent/[0.03] to-transparent p-6 sm:flex-row sm:items-center md:p-7"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <ShieldCheck size={21} />
        </span>
        <p className="text-sm leading-relaxed text-muted md:text-[15px]">
          Both branches are wrong — so today, issuers simply don&rsquo;t distribute
          on-chain at all.{" "}
          <span className="font-bold text-white">Talon resolves it:</span> pay where
          compliant, escrow where not, and release per-beneficiary the moment they
          re-verify.
        </p>
      </div>
    </div>
  );
}
