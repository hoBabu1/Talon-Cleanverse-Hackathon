import { ArrowUpRight } from "lucide-react";
import addresses from "@/lib/generated/addresses.json";
import { EXPLORER_ADDRESS_URL, shortAddress } from "@/lib/site";
import Reveal from "./Reveal";
import SectionHeader from "./SectionHeader";

const PARTNERS = [
  { monogram: "M", name: "Monad", note: "Execution layer · Chain 10143", tint: "bg-[#836ef9]/15 text-[#b3a4fc]" },
  { monogram: "CVI", name: "Cleanverse Identity", note: "Revocable A-Pass credentials", tint: "bg-accent/10 text-accent" },
  { monogram: "CVA", name: "Cleanverse Assets", note: "Policy-enforced A-Tokens", tint: "bg-accent/10 text-accent" },
  { monogram: "$", name: "aUSDC", note: "Verified coupon currency", tint: "bg-sky-400/10 text-sky-300" },
] as const;

const CONTRACTS = [
  { label: "EscrowVault", address: addresses.EscrowVault },
  { label: "CorporateActionManager", address: addresses.CorporateActionManager },
] as const;

function PartnerPills({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-4 pr-4" aria-hidden={ariaHidden || undefined}>
      {PARTNERS.map((p) => (
        <div
          key={p.name}
          className="flex items-center gap-3.5 whitespace-nowrap rounded-full border border-edge bg-card py-3 pl-3.5 pr-6"
        >
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold tracking-wide ${p.tint}`}
          >
            {p.monogram}
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">
              {p.name}
            </span>
            <span className="block text-xs text-muted">{p.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function BuiltOn() {
  return (
    <section id="built-on" className="scroll-mt-24 border-t border-white/5">
      <div className="mx-auto w-full max-w-6xl px-5 py-20 md:px-8 md:py-28">
        <SectionHeader
          eyebrow="Built on"
          title="Standing on verified rails."
          lead="Talon doesn't re-implement compliance — it composes it. Identity, assets, and settlement come from infrastructure that was built to be trusted."
        />

        <Reveal delay={140}>
          <div className="marquee marquee-mask mt-14 overflow-hidden">
            <div className="marquee-track flex w-max animate-marquee">
              <PartnerPills />
              <PartnerPills ariaHidden />
            </div>
          </div>
        </Reveal>

        <Reveal delay={220}>
          <div className="mt-12 flex flex-col items-center gap-4 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Contracts deployed &amp; frozen · Monad testnet
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {CONTRACTS.map((c) => (
                <a
                  key={c.label}
                  href={`${EXPLORER_ADDRESS_URL}${c.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-edge bg-card px-4 py-2 text-xs font-medium text-muted transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:text-white"
                >
                  {c.label}
                  <span className="font-mono text-[11px]">
                    {shortAddress(c.address)}
                  </span>
                  <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
