import type { LucideIcon } from "lucide-react";

export interface BadgeMeta {
  label: string;
  icon?: LucideIcon;
  text: string;
  bg: string;
  border: string;
  dashed?: boolean;
}

/**
 * Generic icon + label pill shell, shared by every `_META`-driven badge
 * (holder display state, action lifecycle, escrow reason, audit outcome).
 * The `_META` records stay separate per domain — this is only the JSX shell
 * that was previously copy-pasted three times with identical classes.
 */
export function Badge({ meta }: { meta: BadgeMeta }) {
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-card border px-2.5 py-1 text-xs font-medium ${meta.text} ${meta.bg} ${meta.border} ${meta.dashed ? "border-dashed" : ""}`}
    >
      {Icon && <Icon size={13} strokeWidth={2} />}
      {meta.label}
    </span>
  );
}
