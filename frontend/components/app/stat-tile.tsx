import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One dashboard metric. Kept deliberately plain — a label, a big value, an
 * optional sub-line and icon — so a row of them reads as one instrument panel
 * rather than a pile of cards.
 */
export function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  accent = false,
  className = "",
  valueClassName = "text-2xl",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  accent?: boolean;
  className?: string;
  /** Override the value's type scale. The default `text-2xl` is tuned for short
   * numbers ("9", "69.7K"); longer text like a full date needs a smaller size so
   * it fits the narrow tile instead of being truncated to "Jul 30, 20…". */
  valueClassName?: string;
}) {
  return (
    <div
      className={`group/tile relative overflow-hidden rounded-card border bg-card p-4 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-accent/60 hover:shadow-[0_16px_40px_-12px_rgba(248,101,28,0.35)] ${
        accent ? "border-accent/40" : "border-edge"
      } ${className}`}
    >
      {/* Orange glow that blooms from the corner on hover */}
      <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/20 opacity-0 blur-2xl transition-opacity duration-300 group-hover/tile:opacity-100" />
      <div className="relative flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted/70 transition-colors group-hover/tile:text-accent/80">
          {label}
        </p>
        {Icon && (
          <Icon
            size={15}
            className={`transition-all duration-300 group-hover/tile:scale-125 group-hover/tile:text-accent ${accent ? "text-accent" : "text-muted/50"}`}
          />
        )}
      </div>
      <p
        title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}
        className={`relative mt-2 truncate font-bold tabular-nums transition-colors duration-300 group-hover/tile:text-accent ${valueClassName} ${
          accent ? "text-accent" : "text-white"
        }`}
      >
        {value}
      </p>
      {sub != null && <p className="relative mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}
