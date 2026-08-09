import LayerStack from "./LayerStack";
import Reveal from "./Reveal";
import SectionHeader from "./SectionHeader";

const STEPS = [
  {
    title: "Live Cap Table",
    body: "Every A-Token transfer is indexed into a live register, and each wallet's A-Pass status is polled against the Cleanverse API — staleness shown, never hidden.",
  },
  {
    title: "Corporate Action Declared",
    body: "The issuer declares a coupon, dividend, or redemption against a record block. The entitled holder set is committed on-chain as a running hash.",
  },
  {
    title: "Pay-Date Re-Verification",
    body: "At execution, every holder's eligibility is checked live. Verified on the record date is a claim — verified on the pay date is a payout.",
  },
  {
    title: "Payout or Escrow",
    body: "Still-verified wallets are paid directly. Lapsed wallets' entitlements are escrowed per-beneficiary — released the moment they re-verify.",
  },
] as const;

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-t border-white/5">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <SectionHeader
          eyebrow="How it works"
          title="Four layers. One lifecycle."
          lead="From live cap table to paid-out coupon — every step on-chain, every step attributable."
        />

        <div className="mt-14 grid items-center gap-12 lg:mt-20 lg:grid-cols-2 lg:gap-16">
          <Reveal delay={120} className="order-2 lg:order-1">
            <div className="flex justify-center rounded-card border border-edge bg-gradient-to-b from-card to-ink p-6 md:p-10">
              <LayerStack />
            </div>
          </Reveal>

          <ol className="order-1 flex flex-col gap-8 lg:order-2">
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={120 + i * 100}>
                <li className="relative flex gap-5">
                  {i < STEPS.length - 1 ? (
                    <span
                      aria-hidden
                      className="absolute -bottom-8 left-[17px] top-10 w-px bg-edge"
                    />
                  ) : null}
                  <span className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white shadow-[0_6px_20px_rgba(248,101,28,0.35)]">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-white md:text-lg">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">
                      {step.body}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
