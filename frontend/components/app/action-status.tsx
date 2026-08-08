import { CheckCircle2, Circle, Clock, FileClock, type LucideIcon } from "lucide-react";
import type { ActionStatus, ExclusionReason } from "@/lib/api";
import { Badge } from "@/components/app/badge";

/**
 * Single source of truth for how an action's lifecycle status reads — mirrors
 * `STATE_META` in holder-card.tsx so both pages share one badge language.
 */
export const STATUS_META: Record<
  ActionStatus,
  { label: string; subtitle: string; icon: LucideIcon; text: string; bg: string; border: string; dashed?: boolean }
> = {
  Prepared: {
    label: "Prepared",
    subtitle: "Planned only — nothing on-chain yet",
    icon: FileClock,
    text: "text-zinc-400",
    bg: "bg-zinc-400/10",
    border: "border-zinc-400/20",
    dashed: true,
  },
  Declared: {
    label: "Declared",
    subtitle: "On-chain, awaiting execution",
    icon: Circle,
    text: "text-accent",
    bg: "bg-accent/10",
    border: "border-accent/20",
  },
  Executing: {
    label: "Executing",
    subtitle: "Batches in progress",
    icon: Clock,
    text: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
  },
  Closed: {
    label: "Closed",
    subtitle: "Finalized",
    icon: CheckCircle2,
    text: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
  },
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  return <Badge meta={STATUS_META[status]} />;
}

/** Plain-English label for a snapshot row's exclusion reason — never the raw enum value. */
export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  rounds_to_zero: "Entitlement rounds to zero",
  zero_address: "Zero address",
  vault: "Escrow vault (excluded by design)",
  manager: "Corporate action manager (excluded by design)",
  token_self: "Token contract itself (excluded by design)",
};
