"use client";

import { ChevronRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import { ActionStatusBadge } from "@/components/app/action-status";
import { type ActionRow } from "@/lib/api";
import { EXPLORER_TX_URL, shortAddress } from "@/lib/site";

function fmt(raw: string): string {
  try {
    return BigInt(raw).toLocaleString("en-US");
  } catch {
    return raw;
  }
}

function whenLabel(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Creative, register-style row for one corporate action — settled progress bar,
 * coverage, status, and a link into the full detail. Surfaces every list field. */
export function ActionListItem({ action }: { action: ActionRow }) {
  const settled = action.paid_count + action.escrowed_count;

  return (
    <div className="group relative rounded-card border border-edge bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_12px_30px_-14px_rgba(248,101,28,0.4)]">
      <Link href={`/actions/${action.action_id}`} className="absolute inset-0 z-10 rounded-card" aria-label={`Open action ${action.action_id}`} />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-bold text-accent">
            #{action.action_id}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Action #{action.action_id}</span>
              <ActionStatusBadge status={action.status} />
            </div>
            <p className="mt-0.5 font-mono text-xs text-muted">
              {shortAddress(action.payment_token)} → {shortAddress(action.asset)} · block {action.record_block}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-white">{fmt(action.total_amount)}</p>
          <p className="text-[11px] text-muted/70">total units</p>
        </div>
      </div>

      {/* settled — clean pills, no bar */}
      <div className="relative mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-edge bg-ink px-2.5 py-1 text-xs font-medium text-muted">
          {settled}/{action.total_holders} settled
        </span>
        {action.paid_count > 0 && (
          <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
            {action.paid_count} paid
          </span>
        )}
        {action.escrowed_count > 0 && (
          <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-400">
            {action.escrowed_count} escrowed
          </span>
        )}
        <span className="ml-auto text-xs font-medium">
          {action.coverage_complete === true ? (
            <span className="text-emerald-400">✓ coverage complete</span>
          ) : action.coverage_complete === false ? (
            <span className="text-amber-400">! incomplete</span>
          ) : (
            <span className="text-muted/60">pending</span>
          )}
        </span>
      </div>

      <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted/70">
        <span>declared {whenLabel(action.declared_at)}</span>
        {action.closed_at && <span>closed {whenLabel(action.closed_at)}</span>}
        {action.declare_tx_hash && (
          <a
            href={`${EXPLORER_TX_URL}${action.declare_tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-20 inline-flex items-center gap-1 transition-colors hover:text-accent"
          >
            {shortAddress(action.declare_tx_hash)} <ExternalLink size={10} />
          </a>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 text-accent opacity-0 transition-opacity group-hover:opacity-100">
          Open <ChevronRight size={12} />
        </span>
      </div>
    </div>
  );
}
