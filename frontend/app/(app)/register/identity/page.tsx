"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/app/badge";
import { ErrorState } from "@/components/app/error-state";
import { STATE_META, relativeTime } from "@/components/app/holder-card";
import { IdentityControl } from "@/components/app/identity-control";
import { IdentityGem } from "@/components/app/identity-gem";
import { IssuerGate } from "@/components/app/issuer-gate";
import Reveal from "@/components/landing/Reveal";
import type { DisplayState, Holder } from "@/lib/api";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useHolders } from "@/lib/queries";
import { shortAddress } from "@/lib/site";

/**
 * The issuer's identity desk: freeze or reinstate a holder's A-Pass, with the whole
 * register's eligibility listed underneath.
 *
 * The roster is deliberately NOT the cap table. The cap table sorts by holdings and
 * paginates, so the one holder you just froze can easily be on page 2 — which is exactly
 * what happened the first time this was demoed. Here every holder is on one page and
 * anyone who can't currently be paid sorts to the top.
 */

/** Problems first. Whoever can't be paid right now is the reason you opened this page. */
const STATE_RANK: Record<DisplayState, number> = {
  frozen: 0,
  expired: 1,
  no_apass: 2,
  unknown: 3,
  active: 4,
};

export default function IdentityPage() {
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const holdersQuery = useHolders();
  const [selected, setSelected] = useState("");

  const holders = useMemo(() => {
    const rows = [...(holdersQuery.data?.holders ?? [])];
    return rows.sort(
      (a, b) =>
        STATE_RANK[a.displayState] - STATE_RANK[b.displayState] ||
        (BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0),
    );
  }, [holdersQuery.data]);

  const ineligible = holders.filter((h) => h.displayState !== "active").length;

  if (ownerLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-20 text-center">
        <Loader2 className="mx-auto animate-spin text-muted" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <IssuerGate
        title="Identity control — issuer only"
        message="Freezing and reinstating Cleanverse credentials is restricted to the asset issuer's wallet."
        publicHref="/register"
        publicLabel="View the public cap table"
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6">
        {/* Deliberately not "Identity control" — the panel below owns that heading, and
            repeating it (with a near-identical subtitle) read as a stutter. This frames
            the page; the card explains the mechanism. */}
        <div className="flex items-center gap-2">
          <ShieldAlert size={22} className="text-accent" />
          <h1 className="text-2xl font-bold text-white">Identity</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          Who in the register can be paid right now — and the switch that changes it.
        </p>
      </Reveal>

      <Reveal className="mb-8">
        <IdentityControl value={selected} onValueChange={setSelected} />
      </Reveal>

      <Reveal>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 px-1">
          <h2 className="text-lg font-semibold text-white">Register eligibility</h2>
          <span className="text-xs text-muted">
            {holdersQuery.isLoading
              ? "Loading…"
              : ineligible === 0
                ? `All ${holders.length} holders eligible`
                : `${ineligible} of ${holders.length} cannot be paid right now`}
          </span>
        </div>

        {holdersQuery.isError ? (
          <ErrorState message={`Couldn't load the register: ${(holdersQuery.error as Error).message}`} />
        ) : (
          <div className="flex flex-col gap-2">
            {holdersQuery.isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-[68px] animate-pulse rounded-card border border-edge bg-card" />
                ))
              : holders.map((h) => (
                  <IdentityRow
                    key={h.wallet}
                    holder={h}
                    selected={h.wallet.toLowerCase() === selected.trim().toLowerCase()}
                    onSelect={() => setSelected(h.wallet)}
                  />
                ))}
          </div>
        )}
      </Reveal>
    </div>
  );
}

function IdentityRow({
  holder,
  selected,
  onSelect,
}: {
  holder: Holder;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = STATE_META[holder.displayState];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-card border bg-card p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 md:gap-4 md:p-4 ${
        selected ? "border-accent/60 shadow-[0_12px_30px_-14px_rgba(248,101,28,0.4)]" : "border-edge"
      } ${holder.stale ? "opacity-70" : ""}`}
    >
      <IdentityGem address={holder.wallet} />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-sm text-white">{shortAddress(holder.wallet)}</span>
        <p className="mt-0.5 truncate text-xs text-muted">{meta.subtitle}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge meta={meta} />
        <span className="hidden text-[11px] text-muted/70 sm:block">
          {holder.lastSyncedAt
            ? `${holder.stale ? "last known" : "synced"} ${relativeTime(holder.lastSyncedAt)}`
            : "never synced"}
        </span>
      </div>
    </button>
  );
}
