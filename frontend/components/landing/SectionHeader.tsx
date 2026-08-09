import Reveal from "./Reveal";

type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  lead?: string;
  align?: "center" | "left";
};

/** Consistent section header: orange eyebrow, extrabold title, muted lead. */
export default function SectionHeader({
  eyebrow,
  title,
  lead,
  align = "center",
}: SectionHeaderProps) {
  const alignClasses =
    align === "center" ? "mx-auto text-center items-center" : "text-left items-start";

  return (
    <Reveal className={`flex max-w-2xl flex-col ${alignClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-white md:text-[40px] md:leading-[1.15]">
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 text-sm leading-relaxed text-muted md:text-base">
          {lead}
        </p>
      ) : null}
    </Reveal>
  );
}
