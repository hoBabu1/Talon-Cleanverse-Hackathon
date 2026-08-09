import { Ban, CircleDollarSign, ShieldCheck } from "lucide-react";
import Reveal from "./Reveal";
import SectionHeader from "./SectionHeader";

export default function Problem() {
  return (
    <section id="problem" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <SectionHeader
          eyebrow="The problem"
          title="Every RWA project stops at issuance."
        />

        <div className="mx-auto mt-8 max-w-3xl">
          <Reveal delay={90}>
            <p className="text-base leading-relaxed text-muted md:text-lg">
              Tokenizing the asset is the easy part. What happens{" "}
              <span className="text-white">after</span> — coupons, dividends,
              redemptions — is still a spreadsheet and a wire transfer. And
              because Cleanverse identity is revocable by design, a holder who
              was verified on the record date can be{" "}
              <span className="text-white">frozen, or let their A-Pass expire,</span>{" "}
              by the pay date. Every real distribution hits this eligibility
              drift. Almost nothing on-chain handles it.
            </p>
          </Reveal>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
          <Reveal delay={120}>
            <div className="h-full rounded-card border border-edge bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-red-400/40 md:p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-400/10 text-red-400">
                  <Ban size={19} />
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-400">
                  Compliance violation
                </p>
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">
                Pay them anyway
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                The A-Token itself reverts — a transfer to a wallet whose A-Pass
                lapsed is a protocol-level compliance breach. There is no
                &ldquo;just send it&rdquo; option, by design.
              </p>
            </div>
          </Reveal>

          <Reveal delay={210}>
            <div className="h-full rounded-card border border-edge bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/40 md:p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-300/10 text-amber-300">
                  <CircleDollarSign size={19} />
                </span>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                  Theft
                </p>
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">
                Pay them nothing
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                The holder earned that coupon while fully verified. Confiscating
                it — or letting it quietly expire back to the issuer —
                isn&rsquo;t compliance. It&rsquo;s taking their money.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={300}>
          <div className="mx-auto mt-4 flex max-w-4xl flex-col items-start gap-4 rounded-card border border-accent/30 bg-accent/[0.05] p-6 sm:flex-row sm:items-center md:p-7">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <ShieldCheck size={21} />
            </span>
            <div>
              <h3 className="text-base font-bold text-white md:text-lg">
                Talon refuses the trade-off.
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Eligibility is re-verified on the pay date, not assumed from the
                record date. Compliant wallets are paid directly; everyone
                else&rsquo;s entitlement waits in escrow under their own name —
                claimable the moment they re-verify.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
