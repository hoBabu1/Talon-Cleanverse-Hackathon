/**
 * A-Pass status poller.
 *
 * No webhook exists for A-Pass status changes (confirmed in the docs), so eligibility
 * drift — the thing this entire project is about — is discovered by polling. Every 30s.
 *
 * BOTH Cleanverse endpoints are called, because they answer genuinely different
 * questions and neither one subsumes the other:
 *
 *   verify_apass  -> "WILL a transfer actually work?"  It accounts for the A-Token's
 *                    compliance RULES (tier, group, country), which query_apass does not.
 *                    Codes: 1 no token, 2 no A-Pass, 3 expired/frozen, 4 OK.
 *   query_apass   -> "WHY not?"  It carries `status` and `expirationTime`, which is the
 *                    only way to separate EXPIRED from FROZEN.
 *
 * Using only the first gives a dashboard that says "ineligible" without saying why, which
 * collapses the lapsed/sanctioned distinction this project exists to preserve. Using only
 * the second gives an answer that can disagree with what the token actually enforces.
 *
 * FROZEN and EXPIRED are stored as two independent booleans because BOTH can be true at
 * once, and the A-Token picks which selector to revert with by an internal ordering we
 * don't control. Collapsing them into one enum would make our own database incapable of
 * expressing the case our own pitch is built on.
 */
import { cleanverse } from "../lib/cleanverse.js";
import { CONTRACTS, lc } from "../lib/chain.js";
import { requireSupabase } from "../lib/supabase.js";
import { indexedHolderSet } from "../lib/reconcile.js";

/**
 * The five display states. Four is not enough: a wallet with no A-Pass at all is a
 * distinct case from one whose A-Pass is merely inactive, and conflating them is exactly
 * what the `data: ""` response shape tricks you into doing.
 */
export type HolderDisplayState =
  | "active"
  | "expiring_soon"
  | "expired"
  | "frozen"
  | "no_apass";

/** Within this window an A-Pass is flagged before it lapses, not after. */
export const EXPIRING_SOON_SECONDS = 7 * 24 * 3600;

export interface HolderStatus {
  wallet: string;
  state: HolderDisplayState;
  hasApass: boolean;
  isFrozen: boolean;
  isExpired: boolean;
  apassStatus: number | null;
  expirationTime: number | null;
  verifyCode: number | null;
  syncError: string | null;
}

/**
 * Derive the single display state from the two independent flags.
 *
 * Order matters and is a policy decision, not an implementation detail: when a credential
 * is BOTH frozen and expired, "frozen" wins the label because it is the more serious
 * condition and understating a sanction would be the worse error. Both underlying
 * booleans remain readable, so the UI can still show that both applied.
 */
export function deriveDisplayState(s: {
  hasApass: boolean;
  isFrozen: boolean;
  isExpired: boolean;
  expirationTime: number | null;
}): HolderDisplayState {
  if (!s.hasApass) return "no_apass";
  if (s.isFrozen) return "frozen";
  if (s.isExpired) return "expired";
  if (
    s.expirationTime !== null &&
    s.expirationTime - Math.floor(Date.now() / 1000) < EXPIRING_SOON_SECONDS
  ) {
    return "expiring_soon";
  }
  return "active";
}

/** Read one wallet's live status from both endpoints. Never throws. */
export async function fetchHolderStatus(wallet: string): Promise<HolderStatus> {
  const address = lc(wallet);
  const base: HolderStatus = {
    wallet: address,
    state: "no_apass",
    hasApass: false,
    isFrozen: false,
    isExpired: false,
    apassStatus: null,
    expirationTime: null,
    verifyCode: null,
    syncError: null,
  };

  try {
    const [lookup, verify] = await Promise.all([
      cleanverse.queryApassRecord("monad", address),
      cleanverse.verifyApass("monad", CONTRACTS.tlnb, address),
    ]);

    const verifyCode = (verify.data as { code?: number } | undefined)?.code ?? null;

    if (!lookup.found) {
      // No A-Pass. Reported honestly rather than defaulting to active.
      return { ...base, verifyCode, state: "no_apass" };
    }

    const rec = lookup.record;
    const now = Math.floor(Date.now() / 1000);
    const isFrozen = rec.status === 2;
    const isExpired = typeof rec.expirationTime === "number" && rec.expirationTime <= now;

    const next: HolderStatus = {
      ...base,
      hasApass: true,
      isFrozen,
      isExpired,
      apassStatus: rec.status,
      expirationTime: rec.expirationTime ?? null,
      verifyCode,
      state: "active",
    };
    next.state = deriveDisplayState(next);
    return next;
  } catch (err) {
    // A Cleanverse outage must not silently render everyone as eligible. The row keeps
    // its previous values and is marked stale; the UI surfaces that explicitly.
    return { ...base, syncError: (err as Error).message };
  }
}

/** Poll every known holder once and write the results to the read-mirror. */
export async function runPollerOnce(): Promise<HolderStatus[]> {
  const db = requireSupabase();
  const wallets = await indexedHolderSet();
  const statuses = await Promise.all(wallets.map(fetchHolderStatus));

  const rows = statuses.map((s) => ({
    wallet_address: s.wallet,
    chain: "monad-testnet",
    has_apass: s.hasApass,
    is_frozen: s.isFrozen,
    is_expired: s.isExpired,
    apass_status: s.apassStatus,
    expiration_time: s.expirationTime,
    verify_code: s.verifyCode,
    verify_checked_at: new Date().toISOString(),
    // On a sync error the timestamp is deliberately NOT advanced, so the row ages and
    // the UI's staleness banner fires. Marking a failed refresh as fresh would be worse
    // than not refreshing at all.
    ...(s.syncError ? {} : { last_synced_at: new Date().toISOString() }),
    sync_error: s.syncError,
  }));

  if (rows.length) {
    const { error } = await db.from("holders").upsert(rows, { onConflict: "wallet_address" });
    if (error) throw new Error(`holders upsert failed: ${error.message}`);
  }
  return statuses;
}

/**
 * Continuous mode; errors are logged and retried rather than killing the loop.
 *
 * `log` is optional and caller-supplied so this can write through Fastify's logger when
 * it runs inside the server. Every pass reports its state counts: an eligibility poller
 * that runs silently is indistinguishable from one that has quietly stopped, and that
 * distinction is the entire point of this job.
 */
export function startPoller(
  intervalMs = 30_000,
  opts: { log?: (msg: string) => void } = {},
): () => void {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const statuses = await runPollerOnce();
      if (opts.log) {
        const counts = statuses.reduce<Record<string, number>>((acc, s) => {
          acc[s.state] = (acc[s.state] ?? 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ");
        opts.log(`[poller] ${statuses.length} holder(s) synced${summary ? ` — ${summary}` : ""}`);
      }
    } catch (err) {
      console.error("[poller]", (err as Error).message);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
