"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Lock, ShieldCheck, UserPlus, Wallet } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { isAddress } from "viem";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import AppButton from "@/components/app/app-button";
import { RegisterDashboard } from "@/components/app/register-dashboard";
import { WalletAddress } from "@/components/app/wallet-address";
import Reveal from "@/components/landing/Reveal";
import { ApiError, onboardHolder, type OnboardResponse } from "@/lib/api";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useWalletHistory } from "@/lib/queries";

type Phase = "idle" | "issuing" | "sign" | "mining" | "done";

export default function OnboardPage() {
  const { isOwner, isLoading: ownerLoading } = useIsOwner();
  const queryClient = useQueryClient();

  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<OnboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { sendTransactionAsync } = useSendTransaction();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const onboard = useMutation({
    mutationFn: onboardHolder,
    onMutate: () => {
      setError(null);
      setPlan(null);
      setTxHash(undefined);
      setPhase("issuing");
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Onboarding failed.");
      setPhase("idle");
    },
    onSuccess: async (data) => {
      setPlan(data);
      setPhase("sign");
      try {
        const hash = await sendTransactionAsync({ to: data.to, data: data.mintCalldata });
        setTxHash(hash);
        setPhase("mining");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Wallet rejected the mint.");
        setPhase("idle");
      }
    },
  });

  // Reacting to the on-chain tx receipt (an external async system): on success we
  // advance the phase and refresh the register views; on failure we surface the error.
  useEffect(() => {
    if (!receipt.isSuccess) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("done");
    void queryClient.invalidateQueries({ queryKey: ["holders"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
  }, [receipt.isSuccess, queryClient]);

  useEffect(() => {
    if (!receipt.isError) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(receipt.error?.message ?? "Mint failed to confirm.");
    setPhase("idle");
  }, [receipt.isError, receipt.error]);

  const addressValid = isAddress(address.trim());
  const amountValid = /^\d+$/.test(amount.trim()) && BigInt(amount.trim() || "0") > BigInt(0);
  const busy = phase === "issuing" || phase === "sign" || phase === "mining";
  const canSubmit = isOwner && addressValid && amountValid && !busy;

  // Look up the typed address so the UI can tell "issue a new identity" apart from
  // "add more to an existing holder" — a wallet that already has an A-Pass only needs
  // the mint, and the button/steps should say so rather than implying a fresh issuance.
  const existing = useWalletHistory(addressValid && isOwner ? address.trim() : null);
  const alreadyHolder = Boolean(existing.data?.identity.hasApass);
  const existingBalance = existing.data?.balance ?? null;

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSubmit) return;
    onboard.mutate({ address: address.trim(), amount: amount.trim(), label: label.trim() || undefined });
  }

  function reset() {
    setAddress("");
    setAmount("");
    setLabel("");
    setPlan(null);
    setTxHash(undefined);
    setError(null);
    setPhase("idle");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6">
        <div className="flex items-center gap-2">
          <UserPlus size={22} className="text-accent" />
          <h1 className="text-2xl font-bold text-white">Onboard a holder</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          Issue a Cleanverse identity and allocate the bond in one flow. The A-Pass is issued server-side; you sign the
          mint from your wallet.
        </p>
      </Reveal>

      <Reveal className="mb-8">
        <RegisterDashboard />
      </Reveal>

      <Reveal>
        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          {/* Form */}
          <div className="rounded-card border border-edge bg-card p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">New holder</h2>
              {!ownerLoading && !isOwner && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-ink px-2.5 py-1 text-xs text-muted">
                  <Lock size={12} /> Issuer only
                </span>
              )}
            </div>

            {!ownerLoading && !isOwner ? (
              <div className="rounded-card border border-edge bg-ink/60 px-4 py-6 text-center text-sm text-muted">
                <ShieldCheck size={22} className="mx-auto mb-2 text-muted/60" />
                Connect the issuer wallet to onboard holders. Identity issuance and minting are restricted to the asset
                issuer — this is a regulated register, not open sign-up.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <Field label="Wallet address" hint={address && !addressValid ? "Not a valid address" : undefined}>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x…"
                    disabled={busy}
                    className="w-full rounded-card border border-edge bg-ink px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-accent disabled:opacity-50"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="TLNB units" hint={amount && !amountValid ? "Whole number > 0" : undefined}>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="e.g. 5000"
                      inputMode="numeric"
                      disabled={busy}
                      className="w-full rounded-card border border-edge bg-ink px-3 py-2.5 text-sm text-white outline-none focus:border-accent disabled:opacity-50"
                    />
                  </Field>
                  <Field label="Label" optional>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. PENSION_FUND"
                      disabled={busy}
                      className="w-full rounded-card border border-edge bg-ink px-3 py-2.5 text-sm text-white outline-none focus:border-accent disabled:opacity-50"
                    />
                  </Field>
                </div>

                {addressValid && alreadyHolder && (
                  <div className="flex items-center gap-2 rounded-card border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
                    <ShieldCheck size={14} className="shrink-0" />
                    Already verified{existingBalance ? ` · holds ${BigInt(existingBalance).toLocaleString("en-US")} TLNB` : ""}. This
                    will allocate more — no new identity issued.
                  </div>
                )}

                <AppButton onClick={() => handleSubmit()} disabled={!canSubmit} loading={busy} className="mt-1 w-full">
                  {phase === "issuing"
                    ? alreadyHolder
                      ? "Preparing allocation…"
                      : "Issuing A-Pass on Cleanverse…"
                    : phase === "sign"
                      ? "Confirm the mint in your wallet…"
                      : phase === "mining"
                        ? "Minting…"
                        : alreadyHolder
                          ? "Add allocation"
                          : "Issue A-Pass & allocate"}
                </AppButton>

                {error && <p className="text-sm text-red-400">{error}</p>}
              </form>
            )}
          </div>

          {/* Status / explainer */}
          <div className="flex flex-col gap-4">
            <StepCard phase={phase} skipApass={alreadyHolder} />
            {phase === "done" && plan && (
              <div className="rounded-card border border-emerald-500/30 bg-emerald-500/5 p-5">
                <div className="mb-2 flex items-center gap-2 text-emerald-400">
                  <CheckCircle2 size={18} />
                  <span className="font-semibold">Holder onboarded</span>
                </div>
                <dl className="space-y-1.5 text-sm">
                  <Row label="Wallet">
                    <WalletAddress wallet={plan.address} />
                  </Row>
                  <Row label="Allocated">{BigInt(plan.amount).toLocaleString("en-US")} TLNB units</Row>
                  <Row label="Customer ID">
                    <span className="font-mono text-xs text-white">{plan.customerId}</span>
                  </Row>
                  <Row label="A-Pass">{plan.apassGenerated ? "Newly issued" : "Already active"}</Row>
                </dl>
                <div className="mt-4 flex gap-2">
                  <Link href="/register" className="flex-1">
                    <AppButton variant="ghost" size="sm" className="w-full">
                      View on register
                    </AppButton>
                  </Link>
                  <AppButton size="sm" className="flex-1" onClick={reset}>
                    Onboard another
                  </AppButton>
                </div>
              </div>
            )}
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {label}
        {optional && <span className="text-muted/50">(optional)</span>}
        {hint && <span className="text-red-400">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-white">{children}</dd>
    </div>
  );
}

const STEPS: { key: Phase; icon: typeof Wallet; title: string; body: string }[] = [
  { key: "issuing", icon: ShieldCheck, title: "Issue identity", body: "Cleanverse generates the A-Pass and we wait until it's usable on-chain." },
  { key: "sign", icon: Wallet, title: "Sign the mint", body: "You approve the TLNB allocation from the issuer wallet." },
  { key: "mining", icon: Loader2, title: "Settle on-chain", body: "The mint confirms; the indexer picks up the new holder." },
];

function StepCard({ phase, skipApass = false }: { phase: Phase; skipApass?: boolean }) {
  const order: Phase[] = ["issuing", "sign", "mining", "done"];
  const activeIdx = order.indexOf(phase);
  return (
    <div className="rounded-card border border-edge bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-white">
        {skipApass ? "This holder is already verified" : "How onboarding works"}
      </h3>
      <ol className="flex flex-col gap-3">
        {STEPS.map((step, i) => {
          // For an existing holder the identity step is skipped by the backend — show it
          // as already-satisfied rather than a step still to run.
          const skipped = skipApass && step.key === "issuing";
          const done = (activeIdx > i && phase !== "idle") || skipped;
          const active = STEPS[i].key === phase && !skipped;
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex gap-3">
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${
                  done
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : active
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-edge bg-ink text-muted/50"
                }`}
              >
                {done ? <CheckCircle2 size={15} /> : <Icon size={14} className={active && step.key === "mining" ? "animate-spin" : ""} />}
              </span>
              <div>
                <p className={`text-sm font-medium ${active ? "text-white" : done ? "text-muted" : "text-muted/70"}`}>
                  {skipped ? "Identity on file" : step.title}
                </p>
                <p className="text-xs text-muted/70">{skipped ? "Already verified — skipped, allocation only." : step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
