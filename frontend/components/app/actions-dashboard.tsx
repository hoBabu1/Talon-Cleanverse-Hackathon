"use client";

import { CheckCircle2, Clock, Coins, ScrollText, Snowflake, Wallet } from "lucide-react";
import { type ActionRow } from "@/lib/api";
import { compactUnits, fmtUnits as fmt } from "@/lib/format";
import { StatTile } from "./stat-tile";

/** Instrument panel for corporate actions, computed straight off the live list so
 * it can never disagree with the rows beneath it. */
export function ActionsDashboard({ actions, loading }: { actions: ActionRow[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-card border border-edge bg-card" />
        ))}
      </div>
    );
  }

  const closed = actions.filter((a) => a.status === "Closed").length;
  const inFlight = actions.filter((a) => a.status === "Declared" || a.status === "Executing").length;
  const distributed = actions.reduce((n, a) => n + BigInt(a.total_amount), BigInt(0));
  const paidLegs = actions.reduce((n, a) => n + a.paid_count, 0);
  const escrowedLegs = actions.reduce((n, a) => n + a.escrowed_count, 0);

  const tiles = [
    { label: "Actions", value: fmt(actions.length), sub: "declared to date", icon: ScrollText, accent: true },
    { label: "Closed", value: fmt(closed), sub: "finalized", icon: CheckCircle2 },
    { label: "In flight", value: fmt(inFlight), sub: "declared / executing", icon: Clock, accent: inFlight > 0 },
    { label: "Distributed", value: compactUnits(distributed), sub: "payment-token units", icon: Coins },
    { label: "Paid legs", value: fmt(paidLegs), sub: "direct payouts", icon: Wallet },
    { label: "Escrowed legs", value: fmt(escrowedLegs), sub: "entitlements preserved", icon: Snowflake, accent: escrowedLegs > 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <StatTile key={t.label} label={t.label} value={t.value} sub={t.sub} icon={t.icon} accent={t.accent} />
      ))}
    </div>
  );
}
