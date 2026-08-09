"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
} from "lucide-react";
import { useEffect, useState } from "react";
import { isAddress } from "viem";
import AppButton from "@/components/app/app-button";
import { Badge } from "@/components/app/badge";
import { STATE_META } from "@/components/app/holder-card";
import {
  ApiError,
  setIdentityStatus,
  type DisplayState,
  type EligibilityState,
  type IdentityAction,
  type IdentityStatusResponse,
} from "@/lib/api";
import { useHolders, useIdentity } from "@/lib/queries";
import { EXPLORER_TX_URL, shortAddress } from "@/lib/site";

/**
 * Issuer-side control for a holder's Cleanverse credential.
 *
 * This is the button that CREATES eligibility drift. Freezing a holder between a record
 * date and a pay date is the exact condition the escrow machinery exists for, so it lives
 * on the register page — directly above the cap table, whose badge flips as soon as the
 * chain enforces the change.
 *
 * The confirmation is shown, not hidden behind a spinner. Cleanverse returning 200 means
 * "request accepted", and transfers keep succeeding for seconds afterwards; the difference
 * between that moment and the moment the token actually refuses is this project's entire
 * argument, so the UI narrates both instead of collapsing them into one "Done".
 */

type Phase = "idle" | "submitting" | "confirming" | "done";

/** The on-chain state each action is waiting to observe. */
const TARGET: Record<IdentityAction, EligibilityState> = { freeze: "frozen", unfreeze: "active" };

/** Probe states map onto the cap table's badges; "inconclusive" has no badge of its own. */
function badgeFor(state: EligibilityState): DisplayState | null {
  return state === "inconclusive" ? null : state;
}

export function IdentityControl() {
  const queryClient = useQueryClient();
  const holdersQuery = useHolders();

  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [action, setAction] = useState<IdentityAction | null>(null);
  const [result, setResult] = useState<IdentityStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const valid = isAddress(address.trim());
  const busy = phase === "submitting" || phase === "confirming";

  // Polled only while a change is in flight — the probe costs a simulated transfer per
  // call, and there is nothing to watch when nothing is moving.
  const identity = useIdentity(valid ? address.trim() : null, busy);
  const live = identity.data;

  const mutation = useMutation({
    mutationFn: setIdentityStatus,
    onMutate: () => {
      setError(null);
      setResult(null);
      setStartedAt(Date.now());
      setElapsed(0);
      setPhase("submitting");
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "The credential update failed.");
      setPhase("idle");
      setAction(null);
    },
    onSuccess: (data) => {
      setResult(data);
      // `confirmed: false` is not a failure — Cleanverse accepted it and the chain hasn't
      // caught up yet. Hand the wait to the poll rather than reporting either outcome.
      setPhase(data.confirmed ? "done" : "confirming");
      if (data.confirmed) refreshRegister();
    },
  });

  function refreshRegister() {
    // The identity probe MUST be re-read here. Polling stops the moment the action
    // completes, so a fast confirmation (an unfreeze can land in under 2s) finishes before
    // the next 3s poll and leaves the badge showing the state we just changed away from —
    // the panel would sit there reading "Frozen" under a "Reinstated" banner.
    void queryClient.invalidateQueries({ queryKey: ["identity"] });
    void queryClient.invalidateQueries({ queryKey: ["holders"] });
    void queryClient.invalidateQueries({ queryKey: ["stats"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-history"] });
  }

  // Reacting to an external async system (the chain, via the polled probe) — same shape as
  // the onboard page's receipt effect. The live probe can observe the flip before the POST
  // returns, since the backend is polling the same chain; whichever sees it first ends the
  // wait.
  useEffect(() => {
    if (phase !== "confirming" && phase !== "submitting") return;
    if (!action || live?.state !== TARGET[action]) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase("done");
    refreshRegister();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.state, phase, action]);

  // Elapsed seconds, ticking, for the "confirming on-chain… 8s" line.
  useEffect(() => {
    if (!busy || startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy, startedAt]);

  function run(next: IdentityAction) {
    if (!valid || busy) return;
    setAction(next);
    mutation.mutate({ address: address.trim(), action: next, reason: "talon-demo" });
  }

  function pick(wallet: string) {
    setAddress(wallet);
    setPhase("idle");
    setAction(null);
    setResult(null);
    setError(null);
  }

  const holders = holdersQuery.data?.holders ?? [];
  const freezeBlocked = live?.freezeBlockedReason ?? null;
  const badge = live ? badgeFor(live.state) : null;

  return (
    <div className="rounded-card border border-edge bg-card p-5 md:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Snowflake size={18} className="text-accent" />
          <h2 className="text-lg font-semibold text-white">Identity control</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-edge bg-ink px-2.5 py-1 text-xs text-muted">
          <Lock size={12} /> Issuer only
        </span>
      </div>
      <p className="mb-4 text-sm text-muted">
        Freeze or reinstate a holder&apos;s Cleanverse A-Pass. This is the drift Talon reacts to — freeze a holder
        between a record date and a pay date and their payout is escrowed, not lost.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">
          Wallet address
          {address && !valid && <span className="text-red-400"> · Not a valid address</span>}
        </span>
        <input
          value={address}
          onChange={(e) => pick(e.target.value)}
          placeholder="0x…"
          disabled={busy}
          className="w-full rounded-card border border-edge bg-ink px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-accent disabled:opacity-50"
        />
      </label>

      {/* Click-to-fill. Typing a 42-character address on camera is its own kind of demo risk. */}
      {holders.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-muted/60">From the register</span>
          {holders.slice(0, 8).map((h) => {
            const meta = STATE_META[h.displayState];
            const on = valid && h.wallet.toLowerCase() === address.trim().toLowerCase();
            return (
              <button
                key={h.wallet}
                type="button"
                disabled={busy}
                onClick={() => pick(h.wallet)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors disabled:opacity-40 ${
                  on ? "border-accent/60 bg-accent/10 text-white" : "border-edge text-muted hover:border-accent/50 hover:text-white"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.text.replace("text-", "bg-")}`} />
                {shortAddress(h.wallet)}
              </button>
            );
          })}
        </div>
      )}

      {/* Live on-chain state — what the token would enforce right now, not what the
          mirror last remembered. */}
      {valid && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-edge bg-ink/60 px-3.5 py-3">
          <span className="text-xs text-muted">On-chain right now</span>
          {/* Three genuinely different answers, never collapsed into one: we haven't asked
              yet, we asked and couldn't reach the backend, and we asked and the chain
              couldn't tell us. Rendering a failed request as "inconclusive" would claim an
              on-chain observation we never made. */}
          {identity.isError ? (
            <span className="text-xs text-red-400">
              Couldn&apos;t read on-chain state: {(identity.error as Error).message}
            </span>
          ) : !live ? (
            <span className="h-6 w-24 animate-pulse rounded-card bg-card" />
          ) : badge ? (
            <Badge meta={STATE_META[badge]} />
          ) : (
            <span className="text-xs text-amber-400">
              Inconclusive — the probe reverted naming another party, so it says nothing about this wallet.
            </span>
          )}
          {live?.expirationTime && (
            <span className="text-xs text-muted/70">
              expires {new Date(live.expirationTime * 1000).toLocaleDateString()}
            </span>
          )}
          {live?.isIssuer && <span className="text-xs font-medium text-accent">issuer wallet</span>}
          {live?.isVault && <span className="text-xs font-medium text-accent">escrow vault</span>}
        </div>
      )}

      {freezeBlocked && (
        <div className="mt-3 flex items-start gap-2.5 rounded-card border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-xs text-amber-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Freezing this wallet is blocked</p>
            <p className="mt-0.5 text-amber-300/80">{freezeBlocked}</p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <AppButton
          onClick={() => run("freeze")}
          disabled={!valid || busy || Boolean(freezeBlocked) || live?.state === "frozen"}
          loading={busy && action === "freeze"}
          variant="ghost"
          className="border-red-400/40 text-red-300 hover:border-red-400/70 hover:text-red-200"
        >
          {!busy && <ShieldAlert size={14} />} Freeze A-Pass
        </AppButton>
        <AppButton
          onClick={() => run("unfreeze")}
          disabled={!valid || busy || live?.state === "active"}
          loading={busy && action === "unfreeze"}
          variant="ghost"
          className="border-emerald-400/40 text-emerald-300 hover:border-emerald-400/70 hover:text-emerald-200"
        >
          {!busy && <ShieldCheck size={14} />} Reinstate
        </AppButton>
      </div>

      {/* The two-stage truth: accepted, then enforced. Shown separately on purpose. */}
      {busy && action && (
        <div className="mt-4 rounded-card border border-accent/30 bg-accent/5 px-3.5 py-3 text-sm">
          <p className="font-medium text-white">
            {phase === "submitting" && !result
              ? `Sending the ${action} to Cleanverse…`
              : "Cleanverse accepted it — confirming on-chain…"}
            <span className="ml-1.5 tabular-nums text-muted">{elapsed}s</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            A 200 from Cleanverse means the request was accepted, not that the token enforces it yet. We poll the
            token itself until it does.
          </p>
        </div>
      )}

      {phase === "done" && action && (
        <div className="mt-4 rounded-card border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-emerald-400">
            <CheckCircle2 size={16} />
            {result?.alreadyInState
              ? "No change needed"
              : action === "freeze"
                ? "Frozen — enforced on-chain"
                : "Reinstated — enforced on-chain"}
          </div>
          <p className="mt-1 text-xs text-muted">
            {result?.note ??
              "Confirmed by the token itself: a transfer to this wallet now behaves the way the badge says."}
          </p>
          {result?.txHash && (
            <a
              href={`${EXPLORER_TX_URL}${result.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline"
            >
              {shortAddress(result.txHash)} <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-card border border-red-400/30 bg-red-400/10 px-3.5 py-3 text-sm text-red-300">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
