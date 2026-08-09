"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleSlash, FileText, Lock, PlayCircle, ShieldCheck, ShieldQuestion, Users, XCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ActionStatusBadge, EXCLUSION_REASON_LABEL } from "@/components/app/action-status";
import AppButton from "@/components/app/app-button";
import { WalletAddress } from "@/components/app/wallet-address";
import { ErrorState } from "@/components/app/error-state";
import Reveal from "@/components/landing/Reveal";
import { ApiError, getBatchCalldata, type ActionBatch, type ActionDetail, type SnapshotRow } from "@/lib/api";
import addresses from "@/lib/generated/addresses.json";
import corporateActionManagerAbi from "@/lib/generated/CorporateActionManager.abi.json";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useTokenDecimals } from "@/lib/hooks/useTokenDecimals";
import { useAction } from "@/lib/queries";
import { EXPLORER_ADDRESS_URL, EXPLORER_TX_URL, shortAddress } from "@/lib/site";

type TabId = "record" | "execute" | "close" | "snapshot";

/** Deterministic color gem from an address — same idea as the cap table. */
function gemStyle(address: string): React.CSSProperties {
  let h = 0;
  for (let i = 2; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 75% 45%))` };
}

function SnapshotItem({ row, decimals }: { row: SnapshotRow; decimals: number }) {
  return (
    <div className={`flex items-center gap-3 rounded-card border border-edge bg-card p-3 transition-colors hover:border-accent/40 ${row.included ? "" : "opacity-70"}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white/90" style={gemStyle(row.holder)} aria-hidden>
        {row.included ? "✓" : "–"}
      </span>
      <div className="min-w-0 flex-1">
        <WalletAddress wallet={row.holder} copiedIcon={CheckCircle2} />
        {!row.included && row.exclusion_reason && (
          <p className="mt-0.5 text-xs text-muted">{EXCLUSION_REASON_LABEL[row.exclusion_reason]}</p>
        )}
      </div>
      <span className="text-right text-sm font-semibold tabular-nums text-white">
        {formatUnits(BigInt(row.entitlement), decimals)}
        <span className="ml-1 text-[11px] font-normal text-muted">units</span>
      </span>
      {row.included ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
          <CheckCircle2 size={12} /> Included
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-400/10 px-2.5 py-1 text-xs font-medium text-zinc-400">
          <CircleSlash size={12} /> Excluded
        </span>
      )}
    </div>
  );
}

type BatchProgress = "done" | "current" | "locked";

function batchProgress(batch: ActionBatch, batches: ActionBatch[], nextIndex: number): BatchProgress {
  const cumulativeBefore = batches
    .filter((b) => b.batch_index < batch.batch_index)
    .reduce((n, b) => n + b.holders.length, 0);
  const cumulativeThrough = cumulativeBefore + batch.holders.length;
  if (nextIndex >= cumulativeThrough) return "done";
  if (nextIndex === cumulativeBefore) return "current";
  return "locked";
}

function ExecuteBatchRow({
  actionId,
  batch,
  decimals,
  onAdvanced,
}: {
  actionId: number;
  batch: ActionBatch;
  decimals: number;
  onAdvanced: () => void;
}) {
  const [signError, setSignError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);

  const calldataQuery = useQuery({
    queryKey: ["batch-calldata", actionId, batch.batch_index],
    queryFn: () => getBatchCalldata(actionId, batch.batch_index),
  });

  const { sendTransactionAsync, isPending: isSigning } = useSendTransaction();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  // Side effect only (notify the parent to re-derive progress from the chain) —
  // no local state mirrors receipt status here, so this isn't copying-a-prop-into-state.
  useEffect(() => {
    if (receipt.isSuccess) onAdvanced();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  async function handleExecute() {
    if (!calldataQuery.data) return;
    setSignError(null);
    try {
      const hash = await sendTransactionAsync({ to: calldataQuery.data.to, data: calldataQuery.data.calldata });
      setTxHash(hash);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Wallet rejected the transaction.");
    }
  }

  if (calldataQuery.data?.alreadyExecuted) {
    return (
      <div className="rounded-card border border-edge bg-ink p-3 text-sm text-muted">
        Batch {batch.batch_index} ({batch.holders.length} holders) — {calldataQuery.data.note}
      </div>
    );
  }

  const isConfirming = Boolean(txHash) && receipt.isLoading;
  const error = signError ?? (receipt.isError ? (receipt.error?.message ?? "Transaction failed to confirm.") : null);

  return (
    <div className="rounded-card border border-accent/30 bg-ink p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-white">
          Batch {batch.batch_index} — {batch.holders.length} holders, {formatUnits(BigInt(batch.batch_total), decimals)} total
        </span>
        <AppButton
          size="sm"
          onClick={handleExecute}
          disabled={!calldataQuery.data || isSigning || isConfirming || receipt.isSuccess}
          loading={isSigning || isConfirming}
        >
          {isSigning ? "Waiting for wallet signature…" : isConfirming ? "Confirming on-chain…" : "Execute batch"}
        </AppButton>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ExecuteSection({ action, isOwner }: { action: ActionDetail; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const { decimals } = useTokenDecimals(action.payment_token);
  const batches = action.batches;

  if (action.status === "Prepared") return null;
  if (batches.length === 0) return null;

  const gateTitle = isOwner ? undefined : "Issuer-only — connect the CAM owner wallet to execute batches";

  return (
    <div id="execute" className="scroll-mt-24 rounded-card border border-edge bg-card p-4 md:p-6">
      <h2 className="text-lg font-semibold text-white">Execute</h2>
      <p className="mt-1 text-sm text-muted">
        Batches run strictly in order — sign, wait for confirmation, then the next batch unlocks.
      </p>
      <fieldset disabled={!isOwner} title={gateTitle} className="mt-4 flex flex-col gap-3">
        {batches.map((batch) => {
          const progress = batchProgress(batch, batches, action.next_index);
          if (progress === "done") {
            return (
              <div
                key={batch.batch_index}
                className="flex items-center gap-3 rounded-card border border-emerald-400/25 bg-emerald-400/[0.06] p-3"
              >
                <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
                <span className="flex-1 text-sm text-white">
                  Batch {batch.batch_index} — {batch.holders.length} holders
                </span>
                <span className="rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400">Done</span>
              </div>
            );
          }
          if (progress === "locked") {
            return (
              <div
                key={batch.batch_index}
                className="flex items-center gap-3 rounded-card border border-edge bg-ink p-3 opacity-60"
              >
                <Lock size={16} className="shrink-0 text-muted" />
                <span className="flex-1 text-sm text-muted">
                  Batch {batch.batch_index} — {batch.holders.length} holders
                </span>
                <span className="text-xs text-muted/70">locked</span>
              </div>
            );
          }
          return (
            <ExecuteBatchRow
              key={batch.batch_index}
              actionId={action.action_id}
              batch={batch}
              decimals={decimals}
              onAdvanced={() => {
                queryClient.invalidateQueries({ queryKey: ["action", String(action.action_id)] });
              }}
            />
          );
        })}
      </fieldset>
    </div>
  );
}

function CloseSection({ action, isOwner }: { action: ActionDetail; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const { writeContractAsync, isPending } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  // Side effect only (re-derive progress from the chain) — no local state mirrors
  // receipt status, so this isn't the copying-a-prop-into-state anti-pattern.
  useEffect(() => {
    if (receipt.isSuccess) {
      queryClient.invalidateQueries({ queryKey: ["action", String(action.action_id)] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  if (action.status === "Prepared" || action.status === "Closed") return null;

  const complete = action.next_index === action.total_holders;
  const gateTitle = isOwner ? undefined : "Issuer-only — connect the CAM owner wallet to close this action";
  const error = signError ?? (receipt.isError ? (receipt.error?.message ?? "closeAction failed to confirm.") : null);

  async function handleClose() {
    setSignError(null);
    try {
      const hash = await writeContractAsync({
        address: addresses.CorporateActionManager as `0x${string}`,
        abi: corporateActionManagerAbi,
        functionName: "closeAction",
        args: [BigInt(action.action_id)],
      });
      setTxHash(hash);
      setConfirming(false);
    } catch (err) {
      setSignError(err instanceof Error ? err.message : "Wallet rejected the transaction.");
    }
  }

  return (
    <div id="close" className="scroll-mt-24 rounded-card border border-edge bg-card p-4 md:p-6">
      <h2 className="text-lg font-semibold text-white">Close</h2>
      <p className="mt-1 text-sm text-muted">
        {complete
          ? "All holders settled — closing verifies the chained-hash commitment."
          : `${action.next_index}/${action.total_holders} holders settled — closing now would be incomplete.`}
      </p>
      <fieldset disabled={!isOwner} title={gateTitle} className="mt-3">
        {!complete && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-card border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-400/20"
          >
            Close incomplete…
          </button>
        )}
        {!complete && confirming && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending || receipt.isLoading}
              className="rounded-card bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {isPending || receipt.isLoading ? "Waiting for wallet signature…" : "Close incomplete (permanent)"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-card border border-edge px-3 py-2 text-sm text-muted hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}
        {complete && (
          <AppButton onClick={handleClose} disabled={isPending || receipt.isLoading} loading={isPending || receipt.isLoading}>
            {isPending || receipt.isLoading ? "Waiting for wallet signature…" : "Close action"}
          </AppButton>
        )}
      </fieldset>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function ActionDetailPage() {
  const params = useParams<{ id: string }>();
  const { isOwner } = useIsOwner();

  const actionQuery = useAction(params.id);

  const { decimals } = useTokenDecimals(actionQuery.data?.payment_token);

  const status = actionQuery.data?.status;
  const batchCount = actionQuery.data?.batches.length ?? 0;
  const snapshotCount = actionQuery.data?.snapshot.length ?? 0;
  const tabs = useMemo<{ id: TabId; label: string; icon: LucideIcon; count: number | null }[]>(() => {
    if (!status) return [];
    const t: { id: TabId; label: string; icon: LucideIcon; count: number | null }[] = [
      { id: "record", label: "Record", icon: FileText, count: null },
    ];
    if (status !== "Prepared" && batchCount > 0) t.push({ id: "execute", label: "Execute", icon: PlayCircle, count: batchCount });
    if (status !== "Prepared" && status !== "Closed") t.push({ id: "close", label: "Close", icon: XCircle, count: null });
    t.push({ id: "snapshot", label: "Snapshot", icon: Users, count: snapshotCount });
    return t;
  }, [status, batchCount, snapshotCount]);

  const [selectedTab, setSelectedTab] = useState<TabId | null>(null);
  // Fall back to the first available tab if the selected one no longer exists
  // (e.g. Close disappears after closing) — derived, not an effect.
  const tab: TabId = selectedTab && tabs.some((t) => t.id === selectedTab) ? selectedTab : (tabs[0]?.id ?? "record");
  const setTab = setSelectedTab;

  if (actionQuery.isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <p className="h-4 w-64 animate-pulse rounded bg-white/5 text-sm text-transparent">loading</p>
      </div>
    );
  }

  if (actionQuery.isError || !actionQuery.data) {
    const message =
      actionQuery.error instanceof ApiError ? actionQuery.error.message : "Couldn't load this action.";
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <Link href="/actions/history" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft size={14} /> Back to history
        </Link>
        <ErrorState message={message} spacing="mt-4" />
      </div>
    );
  }

  const action = actionQuery.data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Link href="/actions/history" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
        <ArrowLeft size={14} /> Back to history
      </Link>

      <Reveal className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-[#c23f00] text-lg font-bold text-white shadow-[0_10px_30px_-8px_rgba(248,101,28,0.5)]">
              #{action.action_id}
            </span>
            <div>
              <h1 className="text-2xl font-bold text-white">Corporate action #{action.action_id}</h1>
              <p className="mt-0.5 font-mono text-xs text-muted">
                {shortAddress(action.payment_token)} → {shortAddress(action.asset)} · record block {action.record_block}
              </p>
            </div>
          </div>
          <ActionStatusBadge status={action.status} />
        </div>
      </Reveal>

      {!isOwner && (
        <Reveal className="mt-4">
          <div className="flex items-start gap-3 rounded-card border border-edge bg-card px-4 py-3 text-sm text-muted">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>Issuer-only controls are disabled — connect the CAM owner wallet to execute or close.</span>
          </div>
        </Reveal>
      )}

      <Reveal className="mt-6">
        <div id="overview" className="scroll-mt-24 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricTile label="Total" value={formatUnits(BigInt(action.total_amount), decimals)} sub="payment units" tone="accent" />
          <MetricTile label="Paid" value={String(action.paid_count)} sub="direct payouts" tone="emerald" />
          <MetricTile label="Escrowed" value={String(action.escrowed_count)} sub="preserved" tone="amber" />
          <MetricTile label="Settled" value={`${action.next_index}/${action.total_holders}`} sub="holders" tone="white" />
        </div>
      </Reveal>

      <Reveal className="mt-4">
        <div className="flex items-center gap-2 rounded-card border border-edge bg-card px-4 py-3 text-sm">
          {action.commitmentParity ? (
            <>
              <ShieldCheck size={16} className="text-emerald-400" />
              <span className="text-emerald-400">Commitment verified</span>
              <span className="text-muted">— on-chain running hash matches the frozen holder-set hash</span>
            </>
          ) : (
            <>
              <ShieldQuestion size={16} className="text-muted" />
              <span className="text-muted">Commitment pending — not yet closed</span>
            </>
          )}
        </div>
      </Reveal>

      {action.status === "Closed" && (
        <Reveal className="mt-4">
          <div
            className={`flex items-start gap-3 rounded-card border px-4 py-3 text-sm ${
              action.coverage_complete
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-400/10 text-amber-300"
            }`}
          >
            {action.coverage_complete ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
            <span>{action.coverage_complete ? "Coverage complete — every holder settled." : "Closed incomplete — not every holder was settled."}</span>
          </div>
        </Reveal>
      )}

      {/* Tab bar — click lands you straight on the panel, no scroll */}
      <div className="sticky top-0 z-20 -mx-4 mt-6 mb-6 flex flex-wrap gap-1.5 border-b border-edge bg-ink/85 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
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
              {t.count !== null && (
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-accent/20 text-accent" : "bg-ink text-muted/70"}`}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "record" && (
      <Reveal>
        <div id="record" className="rounded-card border border-edge bg-card p-4 md:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted/70">On-chain record</h2>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            <Detail label="Status">{action.status}</Detail>
            <Detail label="Record block">{action.record_block}</Detail>
            <Detail label="Payment token">
              <ExplorerAddr addr={action.payment_token} />
            </Detail>
            <Detail label="Asset (about)">
              <ExplorerAddr addr={action.asset} />
            </Detail>
            <Detail label="Total amount">
              {formatUnits(BigInt(action.total_amount), decimals)} <span className="text-xs text-muted">units</span>
            </Detail>
            <Detail label="Settled">
              {action.next_index}/{action.total_holders} · <span className="text-emerald-400">{action.paid_count} paid</span> ·{" "}
              <span className="text-amber-400">{action.escrowed_count} escrowed</span>
            </Detail>
            <Detail label="Coverage">
              {action.coverage_complete === null
                ? "— (not closed)"
                : action.coverage_complete
                  ? "complete"
                  : "incomplete"}
            </Detail>
            <Detail label="Batches">{action.batches.length}</Detail>
            <Detail label="Holder-set hash" mono>
              <span title={action.holder_set_hash}>{shortAddress(action.holder_set_hash)}</span>
            </Detail>
            <Detail label="Running hash" mono>
              {action.running_hash ? <span title={action.running_hash}>{shortAddress(action.running_hash)}</span> : "—"}
            </Detail>
            <Detail label="Declared">
              {new Date(action.declared_at).toLocaleString()}
              {action.declare_tx_hash && (
                <>
                  {" · "}
                  <a href={`${EXPLORER_TX_URL}${action.declare_tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    tx
                  </a>
                </>
              )}
            </Detail>
            <Detail label="Closed">{action.closed_at ? new Date(action.closed_at).toLocaleString() : "—"}</Detail>
          </dl>
        </div>
      </Reveal>
      )}

      {tab === "execute" && (
        <Reveal>
          <ExecuteSection action={action} isOwner={isOwner} />
        </Reveal>
      )}

      {tab === "close" && (
        <Reveal>
          <CloseSection action={action} isOwner={isOwner} />
        </Reveal>
      )}

      {tab === "snapshot" && (
      <Reveal>
        <div id="snapshot" className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Record-date snapshot</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 font-medium text-emerald-400">
              {action.snapshot.filter((r) => r.included).length} included
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-400/10 px-2.5 py-1 font-medium text-zinc-400">
              {action.snapshot.filter((r) => !r.included).length} excluded
            </span>
          </div>
        </div>

        {action.snapshot.length === 0 ? (
          <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-10 text-center text-sm text-muted">
            No snapshot rows.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {action.snapshot.map((row) => (
              <SnapshotItem key={row.holder} row={row} decimals={decimals} />
            ))}
          </div>
        )}
      </Reveal>
      )}
    </div>
  );
}

const TILE_TONE = {
  accent: { value: "text-accent", glow: "group-hover/m:shadow-[0_16px_40px_-12px_rgba(248,101,28,0.4)]", border: "hover:border-accent/60" },
  emerald: { value: "text-emerald-400", glow: "group-hover/m:shadow-[0_16px_40px_-12px_rgba(16,185,129,0.35)]", border: "hover:border-emerald-400/50" },
  amber: { value: "text-amber-400", glow: "group-hover/m:shadow-[0_16px_40px_-12px_rgba(245,158,11,0.35)]", border: "hover:border-amber-400/50" },
  white: { value: "text-white", glow: "group-hover/m:shadow-[0_16px_40px_-12px_rgba(255,255,255,0.15)]", border: "hover:border-white/25" },
} as const;

function MetricTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: keyof typeof TILE_TONE;
}) {
  const t = TILE_TONE[tone];
  return (
    <div className={`group/m relative overflow-hidden rounded-card border border-edge bg-card p-4 transition-all duration-300 hover:-translate-y-1 ${t.border} ${t.glow}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted/70">{label}</p>
      <p className={`mt-1.5 truncate text-2xl font-bold tabular-nums ${t.value}`} title={value}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

function Detail({ label, mono, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-edge/50 pb-2 last:border-0 sm:border-0 sm:pb-0">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-muted/60">{label}</dt>
      <dd className={`text-right text-white ${mono ? "font-mono text-xs" : ""}`}>{children}</dd>
    </div>
  );
}

function ExplorerAddr({ addr }: { addr: string }) {
  return (
    <a
      href={`${EXPLORER_ADDRESS_URL}${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      title={addr}
      className="font-mono text-xs text-accent hover:underline"
    >
      {shortAddress(addr)}
    </a>
  );
}
