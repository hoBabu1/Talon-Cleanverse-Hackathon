/**
 * NO CLEANVERSE WRITE IS COMPLETE UNTIL ON-CHAIN TRUTH CONFIRMS IT.
 *
 * Every Cleanverse write goes through their registrar and lands on-chain *afterwards*.
 * A 200 means "request accepted", never "state changed". This has been observed live on
 * three separate endpoints:
 *
 *   - update_status   (freeze/unfreeze)  — transfer still succeeds for seconds after a 200
 *   - generate_apass  (identity create)  — verify_apass returns code 2 "no A-Pass" right after
 *   - /atoken/launch  (token issuance)   — explicitly async by design, per the docs
 *
 * That is not three special cases. It is one property of the platform, so this is one
 * helper and there are deliberately no variants of it. This exact polling logic has
 * already been re-derived and silently broken twice in this project (see /learning.md);
 * the way to stop that happening a third time is for there to be nothing to re-derive.
 *
 * The load-bearing design decision is that `check` returns a MULTI-WAY state, never a
 * boolean. A poll that fails for an unrelated reason — a drained faucet, an RPC blip —
 * must not be readable as either "confirmed" or "confirmed not". Only the state the
 * caller explicitly asked for ends the wait; everything else, including "inconclusive",
 * keeps waiting and is reported. A boolean here would silently convert "I could not tell"
 * into "no", which is how you confirm a freeze that never landed.
 */

/** A poll outcome: one of the caller's own states, or an explicit "I could not tell". */
export type PollState<S extends string> = S | "inconclusive";

export interface WriteProgress<S extends string> {
  label: string;
  /** What this poll actually observed. */
  state: PollState<S>;
  /** What we are waiting for. */
  want: S;
  /** 1-based. */
  attempt: number;
  elapsedMs: number;
  /** True only on the final, successful poll. */
  confirmed: boolean;
}

export interface AwaitCleanverseWriteOptions<S extends string> {
  /** Human label used in progress lines and the timeout error, e.g. "freeze RETAIL". */
  label: string;
  /** The state that ends the wait. Anything else keeps polling. */
  want: S;
  /** Reads on-chain truth. Must return "inconclusive" rather than guessing. */
  check: () => Promise<PollState<S>>;
  timeoutMs?: number;
  pollMs?: number;
  /**
   * Called after every poll, including the confirming one. This is deliberately a
   * first-class parameter rather than an afterthought: the wait is meant to be SHOWN,
   * not hidden behind a spinner. "Confirming on-chain… 8s" followed by "Confirmed
   * on-chain" is this project's entire thesis — don't trust the app layer, trust
   * on-chain enforcement — demonstrated live in the moment someone is watching.
   */
  onProgress?: (p: WriteProgress<S>) => void;
}

export interface AwaitCleanverseWriteResult<S extends string> {
  state: S;
  attempts: number;
  elapsedMs: number;
}

export class CleanverseWriteTimeoutError extends Error {
  constructor(
    readonly label: string,
    readonly want: string,
    readonly lastState: string,
    readonly attempts: number,
    readonly elapsedMs: number,
  ) {
    super(
      `Timed out confirming "${label}" on-chain after ${Math.round(elapsedMs / 1000)}s ` +
        `(${attempts} polls). Wanted "${want}", last observed "${lastState}". ` +
        `The Cleanverse API may have accepted the write without it landing on-chain.`,
    );
    this.name = "CleanverseWriteTimeoutError";
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 3_000;

export async function awaitCleanverseWrite<S extends string>(
  opts: AwaitCleanverseWriteOptions<S>,
): Promise<AwaitCleanverseWriteResult<S>> {
  const {
    label,
    want,
    check,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    pollMs = DEFAULT_POLL_MS,
    onProgress,
  } = opts;

  const started = Date.now();
  let attempt = 0;
  let lastState: PollState<S> = "inconclusive";

  while (Date.now() - started < timeoutMs) {
    attempt++;

    // A throwing check is itself inconclusive, not a negative result. An RPC hiccup
    // must never be recorded as "confirmed not frozen".
    try {
      lastState = await check();
    } catch {
      lastState = "inconclusive";
    }

    const elapsedMs = Date.now() - started;
    const confirmed = lastState === want;
    onProgress?.({ label, state: lastState, want, attempt, elapsedMs, confirmed });

    if (confirmed) return { state: want, attempts: attempt, elapsedMs };

    // Don't sleep past the deadline just to fail one poll later.
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(pollMs, remaining)));
  }

  throw new CleanverseWriteTimeoutError(label, want, lastState, attempt, Date.now() - started);
}

/**
 * Progress line for a terminal or a log. The frontend renders its own version of this;
 * both exist so the on-chain confirmation is visible rather than implied.
 */
export function formatWriteProgress<S extends string>(p: WriteProgress<S>): string {
  const secs = (p.elapsedMs / 1000).toFixed(0);
  return p.confirmed
    ? `${p.label}: confirmed on-chain (${secs}s, ${p.attempt} poll${p.attempt === 1 ? "" : "s"})`
    : `${p.label}: submitted — confirming on-chain… ${secs}s (observed "${p.state}")`;
}
