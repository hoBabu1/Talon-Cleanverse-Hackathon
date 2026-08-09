"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Snowflake,
  Sparkles,
  Unlock,
  UserX,
  Vault,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import AppButton from "@/components/app/app-button";
import { Badge } from "@/components/app/badge";
import { ErrorState } from "@/components/app/error-state";
import { IdentityGem } from "@/components/app/identity-gem";
import { StatTile } from "@/components/app/stat-tile";
import { WalletAddress } from "@/components/app/wallet-address";
import Reveal from "@/components/landing/Reveal";
import {
  ApiError,
  type EscrowDecodedReason,
  type EscrowDeposit,
  type EscrowLiveBalance,
  type EscrowRelease,
} from "@/lib/api";
import { compactUnits } from "@/lib/format";
import addresses from "@/lib/generated/addresses.json";
import escrowVaultAbi from "@/lib/generated/EscrowVault.abi.json";
import { useIsCorrectChain } from "@/lib/hooks/useIsCorrectChain";
import { useTokenDecimals } from "@/lib/hooks/useTokenDecimals";
import { useEscrow } from "@/lib/queries";
import { shortAddress } from "@/lib/site";

const REASON_META: Record<
  EscrowDecodedReason,
  { label: string; icon: LucideIcon; text: string; bg: string; border: string; dashed?: boolean }
> = {
  frozen: { label: "Frozen", icon: ShieldAlert, text: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/20" },
  expired: { label: "Expired", icon: ShieldOff, text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
  no_apass: { label: "No identity", icon: UserX, text: "text-zinc-400", bg: "bg-zinc-400/10", border: "border-zinc-400/20" },
  other: { label: "Unclassified", icon: AlertTriangle, text: "text-zinc-400", bg: "bg-zinc-400/10", border: "border-zinc-400/20", dashed: true },
};

function DecodedBadge() {
  return (
    <span
      title="The on-chain tag could only say UNKNOWN_REVERT — the backend decoded the real reason from the raw revert bytes."
      className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent"
    >
      <Sparkles size={11} /> decoded
    </span>
  );
}

function friendlyWriteError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (/user rejected|rejected the request/i.test(msg)) return "Wallet rejected the transaction.";
  return "Still not eligible — retry once their credential is restored.";
}

function EscrowRowActions({
  beneficiary,
  token,
  isCorrectChain,
}: {
  beneficiary: string;
  token: string;
  isCorrectChain: boolean;
}) {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [active, setActive] = useState<"claim" | "release" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const isSelf = Boolean(address && address.toLowerCase() === beneficiary.toLowerCase());

  useEffect(() => {
    if (receipt.isSuccess) queryClient.invalidateQueries({ queryKey: ["escrow"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const writeError = receipt.isError ? "Still not eligible — retry once their credential is restored." : error;

  async function run(kind: "claim" | "release") {
    setError(null);
    setActive(kind);
    setTxHash(undefined);
    try {
      const hash =
        kind === "claim"
          ? await writeContractAsync({
              address: addresses.EscrowVault as `0x${string}`,
              abi: escrowVaultAbi,
              functionName: "claim",
              args: [token as `0x${string}`],
            })
          : await writeContractAsync({
              address: addresses.EscrowVault as `0x${string}`,
              abi: escrowVaultAbi,
              functionName: "release",
              args: [beneficiary as `0x${string}`, token as `0x${string}`],
            });
      setTxHash(hash);
    } catch (err) {
      setError(friendlyWriteError(err));
    }
  }

  const busy = (kind: "claim" | "release") => active === kind && (isPending || (Boolean(txHash) && receipt.isLoading));
  const label = (kind: "claim" | "release", idle: string) =>
    active === kind && isPending
      ? "Signing…"
      : active === kind && txHash && receipt.isLoading
        ? "Confirming…"
        : idle;
  const disabledBase = !isConnected || !isCorrectChain || isPending || (Boolean(txHash) && receipt.isLoading);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isSelf && (
          <AppButton size="sm" onClick={() => run("claim")} disabled={disabledBase} loading={busy("claim")}>
            {label("claim", "Claim")}
          </AppButton>
        )}
        <AppButton
          variant="ghost"
          size="sm"
          onClick={() => run("release")}
          disabled={disabledBase}
          loading={busy("release")}
          title={!isConnected ? "Connect a wallet to retry release" : undefined}
        >
          {label("release", "Retry release")}
        </AppButton>
      </div>
      {writeError && <p className="max-w-[220px] text-right text-[11px] text-red-400">{writeError}</p>}
    </div>
  );
}

function LiveEscrowItem({
  row,
  decimals,
  isCorrectChain,
}: {
  row: EscrowLiveBalance & { token: string };
  decimals: number;
  isCorrectChain: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-amber-400/25 bg-amber-400/[0.04] p-3 md:p-4">
      <IdentityGem address={row.beneficiary} />
      <div className="min-w-0 flex-1">
        <WalletAddress wallet={row.beneficiary} copiedIcon={CheckCircle2} />
        <p className="mt-0.5 text-xs text-muted">held in escrow, awaiting eligibility</p>
      </div>
      <span className="text-right text-sm font-semibold tabular-nums text-white">
        {formatUnits(BigInt(row.held), decimals)} <span className="text-[11px] font-normal text-muted">units</span>
      </span>
      <EscrowRowActions beneficiary={row.beneficiary} token={row.token} isCorrectChain={isCorrectChain} />
    </div>
  );
}

function DepositItem({ deposit, decimals }: { deposit: EscrowDeposit; decimals: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-edge bg-card p-3 md:p-4">
      <IdentityGem address={deposit.beneficiary} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <WalletAddress wallet={deposit.beneficiary} copiedIcon={CheckCircle2} />
          <Badge meta={REASON_META[deposit.decodedReason]} />
          {deposit.decodedBeyondOnChainTag && <DecodedBadge />}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {deposit.explanation}
          {deposit.offender && <span className="ml-1">· offender {shortAddress(deposit.offender)}</span>}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-white">
          {formatUnits(BigInt(deposit.amount), decimals)} <span className="text-[11px] font-normal text-muted">units</span>
        </p>
        <Link href={`/actions/${deposit.actionId}`} className="text-xs text-accent hover:underline">
          Action #{deposit.actionId}
        </Link>
      </div>
    </div>
  );
}

function ReleaseItem({ release, decimals }: { release: EscrowRelease; decimals: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-emerald-400/20 bg-emerald-400/[0.04] p-3 md:p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-400" aria-hidden>
        <Unlock size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <WalletAddress wallet={release.beneficiary} copiedIcon={CheckCircle2} />
        <p className="mt-0.5 text-xs text-muted">
          released · triggered by {shortAddress(release.trigger)}
          {release.inferredActionId !== null && (
            <>
              {" · "}
              <Link href={`/actions/${release.inferredActionId}`} className="text-accent hover:underline">
                action #{release.inferredActionId}
                {!release.attributionCertain && " (inferred)"}
              </Link>
            </>
          )}
        </p>
        {release.inferredActionId !== null && !release.attributionCertain && (
          <p className="mt-0.5 text-[11px] text-muted/70">{release.attributionNote}</p>
        )}
      </div>
      <span className="text-right text-sm font-semibold tabular-nums text-emerald-400">
        {formatUnits(BigInt(release.amount), decimals)} <span className="text-[11px] font-normal text-muted">units</span>
      </span>
    </div>
  );
}

type TabId = "live" | "deposits" | "releases";

export default function EscrowPage() {
  const { isCorrectChain } = useIsCorrectChain();
  const escrowQuery = useEscrow();
  const { decimals } = useTokenDecimals(escrowQuery.data?.token);
  const [tab, setTab] = useState<TabId>("live");

  const data = escrowQuery.data;
  const liveEscrowed = useMemo(
    () => (data?.liveBalances ?? []).filter((b) => b.held !== "0").map((b) => ({ ...b, token: data!.token })),
    [data],
  );
  const deposits = data?.deposits ?? [];
  const releases = data?.releases ?? [];

  const tabs: { id: TabId; label: string; icon: LucideIcon; count: number }[] = [
    { id: "live", label: "Live escrow", icon: Snowflake, count: liveEscrowed.length },
    { id: "deposits", label: "Deposits", icon: ShieldAlert, count: deposits.length },
    { id: "releases", label: "Releases", icon: Unlock, count: releases.length },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6">
        <h1 className="text-2xl font-bold text-white">Escrow — Omnibus ledger</h1>
        <p className="mt-1 text-sm text-muted">Every drift-and-recovery, per beneficiary, forever attributed.</p>
      </Reveal>

      {escrowQuery.isError ? (
        <ErrorState
          message={`Couldn't load escrow data: ${escrowQuery.error instanceof ApiError ? escrowQuery.error.message : (escrowQuery.error as Error).message}`}
        />
      ) : (
        <>
          {/* Dashboard */}
          <Reveal className="mb-6">
            {escrowQuery.isLoading || !data ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[92px] animate-pulse rounded-card border border-edge bg-card" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <StatTile label="In escrow" value={compactUnits(data.invariant.totalHeld)} sub="held now" icon={Vault} accent />
                <StatTile label="Live" value={String(liveEscrowed.length)} sub="beneficiaries" icon={Snowflake} accent={liveEscrowed.length > 0} />
                <StatTile label="Frozen" value={String(data.counts.frozen)} sub="deposits" icon={ShieldAlert} />
                <StatTile label="Expired" value={String(data.counts.expired)} sub="deposits" icon={ShieldOff} />
                <StatTile label="Released" value={String(releases.length)} sub="recoveries" icon={Unlock} />
                <StatTile label="Forfeited" value={String(data.counts.forfeited)} sub="never — by design" icon={ShieldCheck} />
              </div>
            )}
          </Reveal>

          {/* Invariant */}
          {data && (
            <Reveal className="mb-8">
              <div
                className={`rounded-card border px-4 py-3.5 ${
                  data.invariant.holds ? "border-emerald-400/25 bg-emerald-400/[0.05]" : "border-red-400/40 bg-red-400/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  {data.invariant.holds ? (
                    <ShieldCheck size={18} className="text-emerald-400" />
                  ) : (
                    <AlertTriangle size={18} className="text-red-300" />
                  )}
                  <code className={`text-sm font-semibold ${data.invariant.holds ? "text-emerald-400" : "text-red-300"}`}>
                    {data.invariant.statement}
                  </code>
                  {data.invariant.holds && <span className="text-xs text-muted">holds — every unit accounted for</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <span>Held: <span className="text-white">{formatUnits(BigInt(data.invariant.totalHeld), decimals)}</span></span>
                  <span>Vault balance: <span className="text-white">{formatUnits(BigInt(data.invariant.vaultBalance), decimals)}</span></span>
                  <span>Surplus: <span className="text-white">{formatUnits(BigInt(data.invariant.surplus), decimals)}</span></span>
                </div>
              </div>
            </Reveal>
          )}

          {/* Tab bar — click lands you straight on the panel, no scroll */}
          <div className="sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap gap-1.5 border-b border-edge bg-ink/85 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
            {tabs.map((t) => {
              const on = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    on ? "border-accent/40 bg-accent/10 text-accent" : "border-edge bg-card text-muted hover:border-accent/30 hover:text-white"
                  }`}
                >
                  <Icon size={14} />
                  {t.label}
                  <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-accent/20 text-accent" : "bg-ink text-muted/70"}`}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Live escrow */}
          {tab === "live" && (
            <Reveal>
              {escrowQuery.isLoading ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 1 }).map((_, i) => <div key={i} className="h-[72px] animate-pulse rounded-card border border-edge bg-card" />)}
                </div>
              ) : liveEscrowed.length === 0 ? (
                <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-10 text-center text-sm text-muted">
                  Nothing currently escrowed — every eligible holder has been paid or released.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {liveEscrowed.map((row) => (
                    <LiveEscrowItem key={row.beneficiary} row={row} decimals={decimals} isCorrectChain={isCorrectChain} />
                  ))}
                </div>
              )}
            </Reveal>
          )}

          {/* Deposits */}
          {tab === "deposits" && (
            <Reveal>
              <p className="mb-3 text-sm text-muted">The audit trail — every escrow deposit, with its decoded reason and offender.</p>
              {deposits.length === 0 ? (
                <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-10 text-center text-sm text-muted">
                  No deposits yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {deposits.map((d) => (
                    <DepositItem key={`${d.txHash}-${d.logIndex}`} deposit={d} decimals={decimals} />
                  ))}
                </div>
              )}
            </Reveal>
          )}

          {/* Releases */}
          {tab === "releases" && (
            <Reveal>
              {releases.length === 0 ? (
                <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-10 text-center text-sm text-muted">
                  No releases yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {releases.map((r) => (
                    <ReleaseItem key={r.txHash} release={r} decimals={decimals} />
                  ))}
                </div>
              )}
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}
