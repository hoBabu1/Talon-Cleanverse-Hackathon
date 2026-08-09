"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useBlockNumber, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { EXCLUSION_REASON_LABEL } from "@/components/app/action-status";
import { ActionsDashboard } from "@/components/app/actions-dashboard";
import { ActionListItem } from "@/components/app/action-list-item";
import AppButton from "@/components/app/app-button";
import { IssuerGate } from "@/components/app/issuer-gate";
import Reveal from "@/components/landing/Reveal";
import { ApiError, prepareAction, type PreparePlanResponse } from "@/lib/api";
import addresses from "@/lib/generated/addresses.json";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useTokenDecimals } from "@/lib/hooks/useTokenDecimals";
import { useActions } from "@/lib/queries";
import { DEMO_ASSET, shortAddress } from "@/lib/site";

function DeclareForm({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState(addresses.aUSDC);
  const [asset, setAsset] = useState<string>(DEMO_ASSET.address);
  const [recordBlock, setRecordBlock] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [batchSize, setBatchSize] = useState("");
  const [plan, setPlan] = useState<PreparePlanResponse | null>(null);
  const [declareError, setDeclareError] = useState<string | null>(null);

  const { decimals } = useTokenDecimals(token);
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const isDemoAsset = asset.trim().toLowerCase() === DEMO_ASSET.address.toLowerCase();

  const prepareMutation = useMutation({
    mutationFn: prepareAction,
    onSuccess: (data) => setPlan(data),
  });

  const { sendTransactionAsync, isPending: isSigning } = useSendTransaction();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  async function handlePrepare(e?: FormEvent) {
    e?.preventDefault();
    setDeclareError(null);
    setPlan(null);
    setTxHash(undefined);
    let amountUnits: bigint;
    try {
      amountUnits = parseUnits(totalAmount || "0", decimals);
    } catch {
      setDeclareError("Total amount is not a valid number.");
      return;
    }
    prepareMutation.mutate({
      token,
      asset,
      recordBlock,
      totalAmount: amountUnits.toString(),
      batchSize: batchSize ? Number(batchSize) : undefined,
    });
  }

  async function handleDeclare() {
    if (!plan) return;
    setDeclareError(null);
    try {
      const hash = await sendTransactionAsync({ to: plan.to, data: plan.declareCalldata });
      setTxHash(hash);
    } catch (err) {
      setDeclareError(err instanceof Error ? err.message : "Wallet rejected the transaction.");
    }
  }

  // Once the declare tx confirms, poll GET /actions/:id until the indexer promotes it.
  useEffect(() => {
    if (!receipt.isSuccess || !plan) return;
    const actionId = plan.actionId;
    let cancelled = false;

    const poll = async () => {
      for (let i = 0; i < 60; i++) {
        if (cancelled) return;
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000"}/actions/${actionId}`,
          );
          if (res.ok) {
            const body = await res.json();
            if (body.status === "Declared" || body.status === "Executing" || body.status === "Closed") {
              router.push(`/actions/${actionId}`);
              return;
            }
          }
        } catch {
          // transient — keep polling
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        setDeclareError("Declared on-chain, but the indexer hasn't picked it up yet. Check the history shortly.");
      }
    };
    void poll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess, plan]);

  const isConfirming = Boolean(txHash) && receipt.isLoading;
  const isWaitingIndexer = receipt.isSuccess;
  const effectiveError = declareError ?? (receipt.isError ? (receipt.error?.message ?? "Transaction failed to confirm.") : null);
  const gateTitle = isOwner ? undefined : "Issuer-only — connect the CAM owner wallet to declare an action";

  const fieldClass =
    "rounded-card border border-edge bg-ink px-3 py-2.5 text-sm text-white outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50";

  return (
    <div className="relative overflow-hidden rounded-card border border-edge bg-card p-5 md:p-6">
      {/* accent wash in the corner for a bit of life */}
      <span className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#c23f00] text-white shadow-[0_8px_22px_-6px_rgba(248,101,28,0.55)]">
          <Sparkles size={18} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-white">Declare a corporate action</h2>
          <p className="text-sm text-muted">Prepare freezes a plan off-chain first. Nothing is declared until you sign.</p>
        </div>
      </div>

      <fieldset disabled={!isOwner} title={gateTitle} className="contents">
        <form onSubmit={handlePrepare} className="relative mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Payment token
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x…" className={`${fieldClass} font-mono`} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Asset (what the action is about)
            <input value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="0x…" className={`${fieldClass} font-mono`} />
            {isDemoAsset && (
              <span className="text-[11px] font-medium text-accent/90">
                {DEMO_ASSET.symbol} · {DEMO_ASSET.name}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            <span className="flex items-center justify-between">
              Record block
              {blockNumber !== undefined && (
                <button
                  type="button"
                  onClick={() => setRecordBlock(blockNumber.toString())}
                  title="Use the current block as the record block"
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-accent transition-colors hover:text-accent/80"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  live: {blockNumber.toLocaleString("en-US")}
                </button>
              )}
            </span>
            <input value={recordBlock} onChange={(e) => setRecordBlock(e.target.value)} placeholder="e.g. 51824000" inputMode="numeric" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
            Total amount (payment-token units)
            <input value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="e.g. 100" inputMode="decimal" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted md:col-span-2">
            Batch size (optional)
            <input value={batchSize} onChange={(e) => setBatchSize(e.target.value)} placeholder="default" inputMode="numeric" className={`${fieldClass} md:w-48`} />
          </label>
          <div className="md:col-span-2">
            <AppButton onClick={() => handlePrepare()} disabled={!isOwner || prepareMutation.isPending} loading={prepareMutation.isPending}>
              Prepare plan
            </AppButton>
          </div>
        </form>
      </fieldset>

      {prepareMutation.isError && (
        <p className="mt-3 text-sm text-red-400">
          {prepareMutation.error instanceof ApiError ? prepareMutation.error.message : "Prepare failed — see console for details."}
        </p>
      )}

      {plan && (
        <div className="mt-5 rounded-card border border-accent/30 bg-ink p-4">
          <h3 className="text-sm font-semibold text-white">
            Plan for action #{plan.actionId} ({plan.totalHolders} holders)
          </h3>
          <p className="mt-1 text-xs text-muted">
            Sum of entitlements: {formatUnits(BigInt(plan.sumEntitlements), decimals)} vs total amount:{" "}
            {formatUnits(BigInt(plan.totalAmount), decimals)}
          </p>

          {plan.excluded.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Excluded holders</p>
              <ul className="mt-1 flex flex-col gap-1">
                {plan.excluded.map((e) => (
                  <li key={e.holder} className="text-xs text-muted">
                    <span className="font-mono text-white">{shortAddress(e.holder)}</span> — {EXCLUSION_REASON_LABEL[e.reason]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Batches</p>
            <ul className="mt-1 flex flex-col gap-1">
              {plan.batches.map((b) => (
                <li key={b.batchIndex} className="text-xs text-muted">
                  Batch {b.batchIndex}: {b.holders} holders, {formatUnits(BigInt(b.batchTotal), decimals)} total
                </li>
              ))}
            </ul>
          </div>

          {effectiveError && <p className="mt-3 text-sm text-red-400">{effectiveError}</p>}

          <AppButton
            onClick={handleDeclare}
            disabled={isSigning || isConfirming || isWaitingIndexer}
            loading={isSigning || isConfirming || isWaitingIndexer}
            className="mt-4"
          >
            {isSigning
              ? "Waiting for wallet signature…"
              : isConfirming
                ? "Confirming on-chain…"
                : isWaitingIndexer
                  ? "Waiting for indexer…"
                  : "Sign & Declare"}
          </AppButton>
        </div>
      )}
    </div>
  );
}

export default function ActionsPage() {
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const actionsQuery = useActions();
  const actions = actionsQuery.data ?? [];

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
        title="Corporate actions — issuer only"
        message="Declaring, executing, and closing distributions is restricted to the asset issuer's wallet."
        publicHref="/actions/history"
        publicLabel="View public action history"
      />
    );
  }

  const inFlight = [...actions].filter((a) => a.status !== "Closed").sort((a, b) => b.action_id - a.action_id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Corporate actions</h1>
          <p className="mt-1 text-sm text-muted">Declare, execute, and close pay-date distributions.</p>
        </div>
        <Link href="/actions/history" className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/50 hover:text-white">
          View full history →
        </Link>
      </Reveal>

      <Reveal className="mb-8">
        <ActionsDashboard actions={actions} loading={actionsQuery.isLoading} />
      </Reveal>

      <Reveal className="mb-8">
        <DeclareForm isOwner={isOwner} />
      </Reveal>

      <Reveal>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted/70">
          In-flight actions {inFlight.length > 0 && <span className="text-muted/50">· {inFlight.length}</span>}
        </h2>
        {actionsQuery.isLoading ? (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[120px] animate-pulse rounded-card border border-edge bg-card" />
            ))}
          </div>
        ) : inFlight.length === 0 ? (
          <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-10 text-center text-sm text-muted">
            No actions in flight. Declared and executing actions appear here until they&apos;re closed.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {inFlight.map((a) => (
              <ActionListItem key={a.action_id} action={a} />
            ))}
          </div>
        )}
      </Reveal>
    </div>
  );
}
