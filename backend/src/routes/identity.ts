/**
 * Issuer-side identity control: freeze and reinstate a holder's Cleanverse A-Pass.
 *
 * This is the switch that CREATES eligibility drift — the condition the whole project
 * exists to handle. Freezing a holder between a record date and a pay date is exactly
 * what turns a payout leg into an escrow leg, so being able to do it on demand is what
 * makes the demo a demonstration rather than an assertion.
 *
 * Authority here is Cleanverse's, not the chain's. `owner()` on our contracts has no say
 * over anyone's credential; the api-id in this backend's env is an Issue Member key, and
 * that is what `update_status` checks. So this route is deliberately not gated on-chain
 * the way declare/execute are — there is nothing on-chain to gate it with. See ADMIN_TOKEN
 * below for the guard that does apply.
 *
 * Every write confirms against ON-CHAIN TRUTH before reporting success, via the one shared
 * `awaitCleanverseWrite` path. A 200 from update_status is "request accepted", never "state
 * changed" — observed live, transfers still succeeding for seconds afterwards.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAddress } from "viem";
import { CONTRACTS, lc } from "../lib/chain.js";
import { cleanverse } from "../lib/cleanverse.js";
import { requireSupabase } from "../lib/supabase.js";
import { awaitFreezeState, issuerAddress, probeEligibility } from "../lib/eligibility.js";
import { CleanverseWriteTimeoutError } from "../lib/awaitCleanverseWrite.js";
import { env } from "../lib/env.js";

/**
 * How long the request itself waits for the chain to enforce the change before handing
 * the wait back to the caller.
 *
 * Freezes have landed in a few seconds every time we've measured, so the common case is a
 * single round trip that returns already-confirmed. The cap exists so a slow registrar
 * can't hold an HTTP connection for two minutes and make the UI look hung — past it, the
 * response says `confirmed: false` honestly and the client polls GET /identity/:wallet.
 */
const INLINE_CONFIRM_MS = 25_000;

type IdentityAction = "freeze" | "unfreeze";

/**
 * Freezing either of these breaks every OTHER holder at once rather than the one you
 * named, because A-Tokens check the SENDER's eligibility too:
 *
 *   - the issuer  — nothing pays out at all while its credential is frozen
 *   - the vault   — every escrowed beneficiary's claim reverts, naming the vault
 *
 * Both are recoverable (unfreeze is never blocked), but recovering mid-recording is not a
 * demo anyone wants to give. Blocked on freeze only.
 */
async function freezeIsSelfHarm(address: string): Promise<string | null> {
  if (lc(address) === lc(CONTRACTS.vault)) {
    return "That's the escrow vault. Its A-Pass is checked as the SENDER on every claim — freezing it breaks every beneficiary's release at once, not just one holder's.";
  }
  if (lc(address) === lc(CONTRACTS.cam)) {
    return "That's the CorporateActionManager, not a holder.";
  }
  const issuer = await issuerAddress();
  if (lc(address) === lc(issuer)) {
    return "That's the issuer wallet. Senders are checked too — freezing it stops every payout in the register, not one holder's. (The flow test does exercise this deliberately; it is not something to do from the dashboard.)";
  }
  return null;
}

/**
 * Optional shared-secret guard, active only when ADMIN_TOKEN is set.
 *
 * Be clear-eyed about what this is: the frontend has to send it from the browser, so it is
 * a speed bump against drive-by calls to a publicly deployed backend, not authentication.
 * The real containment is that this is a sandbox on testnet and every effect is reversible
 * by the same route. Leave it unset for local work.
 */
function adminGuard(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.ADMIN_TOKEN) return true;
  const sent = req.headers["x-talon-admin"];
  if (typeof sent === "string" && sent === env.ADMIN_TOKEN) return true;
  reply.status(401).send({
    error: "This backend requires an admin token for identity writes.",
    code: "ADMIN_TOKEN_REQUIRED",
  });
  return false;
}

export async function identityRoutes(app: FastifyInstance) {
  /**
   * One wallet's live identity, read the way the token reads it.
   *
   * `state` is on-chain truth (a simulated transfer), NOT Cleanverse's record — those two
   * disagree for a few seconds after every write, and this endpoint is what the UI polls
   * to watch a freeze actually land. The Cleanverse record is returned alongside it, as
   * corroboration and as the only source of `expirationTime`.
   */
  app.get<{ Params: { wallet: string } }>("/identity/:wallet", async (req, reply) => {
    const wallet = req.params.wallet?.trim() ?? "";
    if (!isAddress(wallet)) {
      return reply.status(400).send({ error: "Invalid wallet address.", code: "BAD_ADDRESS" });
    }

    const [state, lookup, issuer] = await Promise.all([
      probeEligibility(wallet).catch(() => "inconclusive" as const),
      cleanverse.queryApassRecord("monad", wallet).catch(() => null),
      issuerAddress().catch(() => null),
    ]);

    const record = lookup?.found ? lookup.record : null;
    const blockedReason = await freezeIsSelfHarm(wallet);

    return {
      wallet: lc(wallet),
      state,
      hasApass: Boolean(record),
      apassStatus: record?.status ?? null,
      expirationTime: record?.expirationTime ?? null,
      cvRecordId: record?.cvRecordId ?? null,
      isIssuer: issuer !== null && lc(wallet) === lc(issuer),
      isVault: lc(wallet) === lc(CONTRACTS.vault),
      /** Non-null means a freeze would be refused, and says why. Unfreeze is never blocked. */
      freezeBlockedReason: blockedReason,
    };
  });

  /**
   * Freeze (status 2) or reinstate (status 1) an A-Pass, then confirm on-chain.
   *
   * Returns `confirmed: false` rather than throwing when the chain hasn't caught up within
   * INLINE_CONFIRM_MS — the write was still accepted, and the caller polls GET
   * /identity/:wallet from there. A timeout is a slow registrar, not a failed freeze, and
   * reporting it as a failure would be the same lie in the other direction.
   */
  app.post("/identity/status", async (req, reply) => {
    if (!adminGuard(req, reply)) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const action = body.action as IdentityAction;
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;

    if (!isAddress(address)) {
      return reply.status(400).send({ error: "A valid wallet address is required.", code: "BAD_ADDRESS" });
    }
    if (action !== "freeze" && action !== "unfreeze") {
      return reply.status(400).send({ error: 'action must be "freeze" or "unfreeze".', code: "BAD_ACTION" });
    }

    if (action === "freeze") {
      const blocked = await freezeIsSelfHarm(address);
      if (blocked) {
        return reply.status(400).send({ error: blocked, code: "PROTECTED_ADDRESS" });
      }
    }

    const want = action === "freeze" ? "frozen" : "active";
    const before = await probeEligibility(address).catch(() => "inconclusive" as const);

    // Already where you're asking to be. Don't spend a Cleanverse write on a no-op — and
    // more importantly, don't report a write that never happened as one that did.
    if (before === want) {
      return {
        address: lc(address),
        action,
        alreadyInState: true,
        accepted: false,
        txHash: null,
        confirmed: true,
        state: before,
        elapsedMs: 0,
        note:
          action === "freeze"
            ? "Already frozen on-chain — no change made."
            : "Already eligible on-chain — no change made.",
      };
    }

    const res = await cleanverse.updateStatus({
      status: action === "freeze" ? "2" : "1",
      wallet: { address, chain: "monad" },
      ...(action === "freeze" ? { blacklistReason: reason ?? "talon-demo" } : {}),
    });
    if (res.code !== "0000") {
      return reply.status(502).send({
        error: `Cleanverse refused the status update: ${res.message ?? res.code}`,
        code: "UPDATE_STATUS_FAILED",
      });
    }
    const txHash = (res.data as { txHash?: string } | null)?.txHash ?? null;

    const started = Date.now();
    let confirmed = false;
    let state: string = before;
    try {
      await awaitFreezeState(address, action === "freeze", {
        timeoutMs: INLINE_CONFIRM_MS,
        onProgress: (p) => {
          state = p.state;
          req.log.info(`[identity] ${p.label}: ${p.state} (${Math.round(p.elapsedMs / 1000)}s)`);
        },
      });
      confirmed = true;
      state = want;
    } catch (err) {
      if (!(err instanceof CleanverseWriteTimeoutError)) throw err;
      state = err.lastState;
    }

    // The read-mirror is only advanced once the CHAIN agrees. Writing it off the 200 would
    // paint the cap table badge before the token would actually enforce it, which is the
    // precise misreport this project's whole thesis is built against. Unconfirmed writes
    // are left for the 30s poller to pick up.
    if (confirmed) {
      try {
        const db = requireSupabase();
        await db.from("holders").upsert(
          {
            wallet_address: lc(address),
            chain: "monad-testnet",
            has_apass: true,
            is_frozen: action === "freeze",
            apass_status: action === "freeze" ? 2 : 1,
            last_synced_at: new Date().toISOString(),
            verify_checked_at: new Date().toISOString(),
            sync_error: null,
          },
          { onConflict: "wallet_address" },
        );
      } catch {
        // Best-effort: the poller is the real source, this only removes the ≤30s lag
        // between a confirmed freeze and the cap table showing it.
      }
    }

    return {
      address: lc(address),
      action,
      alreadyInState: false,
      accepted: true,
      txHash,
      confirmed,
      state,
      elapsedMs: Date.now() - started,
      note: confirmed
        ? action === "freeze"
          ? "Frozen — confirmed by the token itself, not just by Cleanverse's response."
          : "Reinstated — the token now allows transfers to this wallet again."
        : `Cleanverse accepted the ${action}, but the chain hasn't enforced it yet after ${Math.round(
            (Date.now() - started) / 1000,
          )}s. Still pending — keep watching this wallet's state.`,
    };
  });
}
