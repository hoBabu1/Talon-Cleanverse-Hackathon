import { FileDown, ShieldCheck, Split, Vault } from "lucide-react";
import Reveal from "./Reveal";
import SectionHeader from "./SectionHeader";

const FEATURES = [
  {
    icon: Vault,
    title: "Per-beneficiary escrow, never pooled",
    body: "Every entitlement sits in its own sub-ledger under the holder's name. Release is just the real transfer retried — Cleanverse itself decides when the wallet is eligible again.",
  },
  {
    icon: Split,
    title: "Frozen is not expired",
    body: "A sanctioned wallet and a lapsed credential are different events. Each escrow is tagged with the actual on-chain revert reason — the audit trail never conflates them.",
  },
  {
    icon: ShieldCheck,
    title: "0% forfeited",
    body: "Value earned while verified is never clawed back and never lost to expiry. The contract has no adminForfeit function at all.",
  },
  {
    icon: FileDown,
    title: "Audit-ready by default",
    body: "Every payout and every release exports with Travel-Rule attribution and the stored Cleanverse report — per beneficiary, per transaction hash.",
  },
] as const;

export default function Features() {
  return (
    <section id="why-talon" className="scroll-mt-24 border-t border-white/5">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <SectionHeader
          eyebrow="Why it's different"
          title="Built for the moment every other project ignores."
          lead="Eligibility drift happens between the record date and the pay date — after the demo ends. Talon is the machinery for exactly that window."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={100 + i * 90} className="h-full">
              <div className="h-full rounded-card border border-edge bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-accent/50">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <feature.icon size={20} />
                </span>
                <h3 className="mt-5 text-base font-bold leading-snug text-white">
                  {feature.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">
                  {feature.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
