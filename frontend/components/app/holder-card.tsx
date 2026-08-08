"use client";

import { CheckCircle2, HelpCircle, ShieldAlert, ShieldOff, UserX, type LucideIcon } from "lucide-react";
import { formatUnits } from "viem";
import type { DisplayState, Holder } from "@/lib/api";
import { Badge } from "@/components/app/badge";
import { WalletAddress } from "@/components/app/wallet-address";

/**
 * Single source of truth for how a display state reads: color, icon, label,
 * and the plain-English subtitle that makes "frozen ≠ expired ≠ forfeited"
 * legible without narration. Reused by the table row, the mobile card, and
 * the header summary counts — never duplicated per breakpoint.
 */
export const STATE_META: Record<
  DisplayState,
  { label: string; subtitle: string; icon: LucideIcon; text: string; bg: string; border: string; dashed?: boolean }
> = {
  active: {
    label: "Verified",
    subtitle: "Verified",
    icon: CheckCircle2,
    text: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/20",
  },
  frozen: {
    label: "Frozen",
    subtitle: "Credential frozen — sanctioned",
    icon: ShieldAlert,
    text: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/20",
  },
  expired: {
    label: "Expired",
    subtitle: "Credential expired — no fault, entitlement preserved",
    icon: ShieldOff,
    text: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/20",
  },
  no_apass: {
    label: "No identity",
    subtitle: "No Cleanverse identity",
    icon: UserX,
    text: "text-zinc-400",
    bg: "bg-zinc-400/10",
    border: "border-zinc-400/20",
  },
  unknown: {
    label: "Unknown",
    subtitle: "Status not yet synced",
    icon: HelpCircle,
    text: "text-zinc-500",
    bg: "bg-zinc-500/10",
    border: "border-zinc-500/20",
    dashed: true,
  },
};

/**
 * Age of a timestamp, in words. A bare clock time ("12:01:58") reads as fresh at a
 * glance even when it's hours old, which is exactly the misreading the staleness
 * design exists to prevent — the whole point is that the reader can tell how much to
 * trust the row without doing arithmetic.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 10) return "just now";

  // `numeric: "always"` on purpose: "auto" renders one month as "last mo." and one day as
  // "yesterday", which read as garbage behind this component's prefixes ("Last known last
  // mo."). "just now" above covers the only case where a word beats a number.
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "always", style: "short" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.348],
    ["month", 12],
    ["year", Infinity],
  ];

  // Future timestamps (clock skew between the poller's host and the browser) would
  // otherwise render as "in 3 seconds", which reads like a bug. Clamp to the past.
  let value = Math.max(seconds, 0);
  for (const [unit, step] of units) {
    if (value < step) return rtf.format(-Math.round(value), unit);
    value /= step;
  }
  return "a long time ago";
}

function lastSynced(holder: Holder): string {
  if (!holder.lastSyncedAt) return "Never synced";
  const ago = relativeTime(holder.lastSyncedAt);
  // "Last known" is kept verbatim for stale rows: it is the honesty signal that the
  // row is a remembered state, not a confirmed one.
  return holder.stale ? `Last known ${ago}` : `Synced ${ago}`;
}

interface HolderCardProps {
  holder: Holder;
  decimals: number;
  variant: "row" | "card";
}

/**
 * The one place that renders a holder. `variant` picks the DOM shape (a
 * `<tr>` for the desktop table vs. a `<div>` card for mobile) but both draw
 * on the same `STATE_META` mapping and the same formatted balance — so the
 * state-to-visual logic is never duplicated per breakpoint.
 */
export function HolderCard({ holder, decimals, variant }: HolderCardProps) {
  const formattedBalance = formatUnits(BigInt(holder.balance), decimals);
  const meta = STATE_META[holder.displayState];

  if (variant === "row") {
    return (
      <tr className={`border-b border-edge last:border-0 ${holder.stale ? "opacity-70" : ""}`}>
        <td className="px-4 py-3">
          <WalletAddress wallet={holder.wallet} />
        </td>
        <td className="px-4 py-3 text-sm text-white">{formattedBalance}</td>
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1">
            <Badge meta={meta} />
            <span className="text-xs text-muted">{meta.subtitle}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-muted">{lastSynced(holder)}</td>
      </tr>
    );
  }

  return (
    <div className={`rounded-card border border-edge bg-card p-4 ${holder.stale ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <WalletAddress wallet={holder.wallet} />
        <Badge meta={meta} />
      </div>
      <p className="mt-2 text-xs text-muted">{meta.subtitle}</p>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-white">{formattedBalance}</span>
        <span className="text-xs text-muted">{lastSynced(holder)}</span>
      </div>
    </div>
  );
}
