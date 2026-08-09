"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  ExternalLink,
  PlusCircle,
  ShieldCheck,
  Snowflake,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { isAddress } from "viem";
import { Badge } from "@/components/app/badge";
import { ErrorState } from "@/components/app/error-state";
import { STATE_META } from "@/components/app/holder-card";
import { StatTile } from "@/components/app/stat-tile";
import { WalletAddress } from "@/components/app/wallet-address";
import Reveal from "@/components/landing/Reveal";
import { type DisplayState, type HistoryEvent, type HistoryEventType } from "@/lib/api";
import { EXPLORER_TX_URL, shortAddress } from "@/lib/site";
import { useWalletHistory } from "@/lib/queries";

const TX_URL = EXPLORER_TX_URL;

const REASON_LABEL: Record<string, string> = {
  "0x322fde89": "credential frozen",
  "0xaecc0dbe": "credential expired",
  "0x4731ab32": "transfer returned false",
  "0x19957115": "unknown revert",
};

type EventMeta = { label: string; icon: LucideIcon; ring: string; text: string; denom: string };

function eventMeta(type: HistoryEventType): EventMeta {
  switch (type) {
    case "mint":
      return { label: "Allocated TLNB", icon: PlusCircle, ring: "border-emerald-400/30 bg-emerald-400/10", text: "text-emerald-400", denom: "TLNB" };
    case "transfer_in":
      return { label: "Received TLNB", icon: ArrowDownLeft, ring: "border-sky-400/30 bg-sky-400/10", text: "text-sky-400", denom: "TLNB" };
    case "transfer_out":
      return { label: "Sent TLNB", icon: ArrowUpRight, ring: "border-zinc-400/30 bg-zinc-400/10", text: "text-zinc-300", denom: "TLNB" };
    case "payout_paid":
      return { label: "Coupon paid", icon: BadgeCheck, ring: "border-emerald-400/30 bg-emerald-400/10", text: "text-emerald-400", denom: "aUSDC" };
    case "payout_escrowed":
      return { label: "Entitlement escrowed", icon: Snowflake, ring: "border-amber-400/30 bg-amber-400/10", text: "text-amber-400", denom: "aUSDC" };
    case "escrow_release":
      return { label: "Escrow released", icon: Unlock, ring: "border-accent/40 bg-accent/10", text: "text-accent", denom: "aUSDC" };
  }
}

function fmt(raw: string): string {
  try {
    return BigInt(raw).toLocaleString("en-US");
  } catch {
    return raw;
  }
}

function stateKey(state: string): DisplayState {
  return (["active", "frozen", "expired", "no_apass"].includes(state) ? state : "unknown") as DisplayState;
}

export default function WalletHistoryPage() {
  const params = useParams<{ wallet: string }>();
  const wallet = typeof params.wallet === "string" ? params.wallet : "";
  const valid = isAddress(wallet);
  const { data, isLoading, isError, error } = useWalletHistory(valid ? wallet : null);

  if (!valid) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
        <BackLink />
        <ErrorState message="That doesn't look like a valid wallet address." />
      </div>
    );
  }

  const meta = data ? STATE_META[stateKey(data.identity.state)] : null;
  const expiry = data?.identity.expirationTime
    ? new Date(data.identity.expirationTime * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <BackLink />

      <Reveal className="mb-6 mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-white">Holder history</h1>
          {meta && <Badge meta={meta} />}
        </div>
        <div className="mt-2">
          <WalletAddress wallet={wallet} />
        </div>
      </Reveal>

      {isError ? (
        <ErrorState message={`Couldn't load history: ${(error as Error).message}`} />
      ) : (
        <>
          <Reveal className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[92px] animate-pulse rounded-card border border-edge bg-card" />)
            ) : (
              <>
                <StatTile label="Balance" value={fmt(data.balance)} sub="TLNB units" icon={PlusCircle} accent />
                <StatTile label="Identity" value={meta?.label ?? "—"} sub={data.identity.hasApass ? "A-Pass on file" : "no A-Pass"} icon={ShieldCheck} />
                <StatTile label="A-Pass expiry" value={expiry} sub={data.identity.cvRecordId ? `record ${data.identity.cvRecordId}` : "—"} />
                <StatTile label="Events" value={data.events.length} sub="on-chain records" />
              </>
            )}
          </Reveal>

          <Reveal>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted/70">Timeline</h2>
            {isLoading || !data ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-card border border-edge bg-card" />
                ))}
              </div>
            ) : data.events.length === 0 ? (
              <div className="rounded-card border border-edge bg-card px-4 py-10 text-center text-sm text-muted">
                No on-chain activity recorded for this wallet yet.
              </div>
            ) : (
              <ol className="relative flex flex-col gap-3 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-edge">
                {data.events.map((ev, i) => (
                  <TimelineRow key={`${ev.txHash}-${ev.type}-${i}`} ev={ev} />
                ))}
              </ol>
            )}
          </Reveal>
        </>
      )}
    </div>
  );
}

function TimelineRow({ ev }: { ev: HistoryEvent }) {
  const m = eventMeta(ev.type);
  const Icon = m.icon;
  const reason = typeof ev.detail.reasonSelector === "string" ? REASON_LABEL[ev.detail.reasonSelector] : undefined;
  const actionId =
    ev.detail.actionId != null ? String(ev.detail.actionId) : ev.detail.inferredActionId != null ? String(ev.detail.inferredActionId) : null;

  return (
    <li className="relative z-10 flex items-start gap-3">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${m.ring}`}>
        <Icon size={18} className={m.text} />
      </span>
      <div className="flex-1 rounded-card border border-edge bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-white">{m.label}</span>
          <span className={`text-sm font-semibold tabular-nums ${m.text}`}>
            {fmt(ev.amount)} <span className="text-xs font-normal text-muted">{m.denom}</span>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {actionId && <span>Action #{actionId}</span>}
          {reason && <span className="text-amber-400/90">{reason}</span>}
          {ev.detail.attributionCertain === false && <span className="text-muted/60">inferred</span>}
          <span>block {ev.blockNumber.toLocaleString("en-US")}</span>
          <a
            href={`${TX_URL}${ev.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 transition-colors hover:text-accent"
          >
            {shortAddress(ev.txHash)} <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </li>
  );
}

function BackLink() {
  return (
    <Link href="/register" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:underline">
      <ArrowLeft size={15} /> Back to cap table
    </Link>
  );
}
