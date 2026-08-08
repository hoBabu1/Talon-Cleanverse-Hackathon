"use client";

import { Coins, Landmark, ScrollText, ShieldCheck, Snowflake, Vault } from "lucide-react";
import { compactUnits, fmtUnits as fmt } from "@/lib/format";
import { useStats } from "@/lib/queries";
import { StatTile } from "./stat-tile";

/** The register's instrument panel — reused on Onboard and Cap Table so both
 * pages show the same live totals. */
export function RegisterDashboard() {
  const { data, isLoading, isError } = useStats();

  if (isError) return null;

  const s = data;
  const skeleton = isLoading || !s;

  const tiles = skeleton
    ? null
    : [
        { label: "Holders", value: fmt(s.capTable.totalHolders), sub: "on the register", icon: Landmark, accent: true },
        { label: "Total supply", value: compactUnits(s.capTable.totalSupply), sub: "TLNB units", icon: Coins },
        {
          label: "Verified active",
          value: fmt(s.identity.active),
          sub: `${fmt(s.identity.frozen)} frozen · ${fmt(s.identity.expired)} expired`,
          icon: ShieldCheck,
        },
        {
          label: "Corporate actions",
          value: fmt(s.actions.total),
          sub: `${fmt(s.actions.closed)} closed · ${fmt(s.actions.open)} open`,
          icon: ScrollText,
        },
        { label: "Total paid", value: compactUnits(s.value.totalPaid), sub: "aUSDC distributed", icon: Vault },
        {
          label: "In escrow",
          value: compactUnits(s.value.currentlyEscrowed),
          sub: `${compactUnits(s.value.totalReleased)} released to date`,
          icon: Snowflake,
          accent: BigInt(s.value.currentlyEscrowed || "0") > BigInt(0),
        },
      ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {skeleton
        ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[92px] animate-pulse rounded-card border border-edge bg-card" />
          ))
        : tiles!.map((t) => (
            <StatTile key={t.label} label={t.label} value={t.value} sub={t.sub} icon={t.icon} accent={t.accent} />
          ))}
    </div>
  );
}
