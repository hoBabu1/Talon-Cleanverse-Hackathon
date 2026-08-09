import DriftDiagram from "./DriftDiagram";
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

        <DriftDiagram />
      </div>
    </section>
  );
}
