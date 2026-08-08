/**
 * Holder onboarding, per-wallet history, and register-wide stats.
 *
 * Onboarding is a two-actor flow by design: the BACKEND issues the A-Pass (it holds the
 * Cleanverse credentials), but the MINT is signed by the issuer's own wallet in the browser
 * — this backend never holds a private key, exactly like the declare/execute flow. So
 * `/holders/onboard` does the identity half server-side and returns mint calldata for the
 * wallet to sign. The A-Pass must exist and be usable BEFORE the mint, or minting reverts
 * with NoAPass(address) — confirmed live — so we generate and wait here, then hand back
 * calldata the caller can sign with confidence.
 */
import type { FastifyInstance } from "fastify";
import { encodeFunctionData, isAddress, parseAbi } from "viem";
import { CONTRACTS, lc, publicClient } from "../lib/chain.js";
import { requireSupabase } from "../lib/supabase.js";
import { cleanverse } from "../lib/cleanverse.js";
import { awaitApassUsable, probeEligibility } from "../lib/eligibility.js";
import { reconcileCapTable } from "../lib/reconcile.js";

const MINT_ABI = parseAbi(["function mint(address to, uint256 amount)"]);
const BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/** ~5 years out — matches the deliberately far-future expiry used elsewhere so a
 * demo A-Pass doesn't lapse mid-hackathon. */
function farFutureExpiry(): number {
  return Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600;
}

/**
 * Cleanverse customerId rules: at least 12 chars, only [A-Za-z0-9]. It strips
 * non-alphanumerics BEFORE the length check, so an underscore yields a misleading
 * length error — we sanitize first, then guarantee length.
 */
function deriveCustomerId(label: string | undefined, address: string): string {
  const seed = (label && label.trim() ? label : address).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `TALON${seed}`.padEnd(12, "0").slice(0, 20);
}

export async function onboardRoutes(app: FastifyInstance) {
  /**
   * Issue an A-Pass for a new wallet (server-side) and return mint calldata for the
   * issuer to sign. Gating is on-chain, not here: minting requires MINTER_ROLE, which
   * only the issuer wallet holds — so even an unauthenticated call can at most create a
   * (free) sandbox A-Pass and receive calldata it cannot execute.
   */
  app.post("/holders/onboard", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const rawAmount = typeof body.amount === "string" ? body.amount.trim() : String(body.amount ?? "");
    const label = typeof body.label === "string" ? body.label.trim() : undefined;

    if (!isAddress(address)) {
      return reply.status(400).send({ error: "A valid wallet address is required.", code: "BAD_ADDRESS" });
    }
    let amount: bigint;
    try {
      amount = BigInt(rawAmount);
    } catch {
      return reply.status(400).send({ error: "Amount must be a whole number of TLNB units.", code: "BAD_AMOUNT" });
    }
    if (amount <= 0n) {
      return reply.status(400).send({ error: "Amount must be greater than zero.", code: "BAD_AMOUNT" });
    }
    // Onboarding allocates the demo bond (TLNB); paying holders in aUSDC is a corporate
    // action, a separate flow.
    if (lc(address) === lc(CONTRACTS.vault) || lc(address) === lc(CONTRACTS.cam)) {
      return reply.status(400).send({ error: "That address is a protocol contract, not a holder.", code: "BAD_ADDRESS" });
    }

    const customerId = deriveCustomerId(label, address);

    // Skip generation if the wallet already has a usable credential — re-issuing is
    // wasteful and can error. Otherwise generate and WAIT until it's usable on-chain
    // (a 200 from generate_apass is not proof; the chain catches up after).
    let apassGenerated = false;
    let cvRecordId: string | null = null;
    const state = await probeEligibility(address).catch(() => "no_apass" as const);

    if (state !== "active") {
      const gen = await cleanverse.generateApass({
        customerId,
        expirationTime: farFutureExpiry(),
        wallet: { address, chain: "monad" },
      });
      if (gen.code !== "0000") {
        return reply
          .status(502)
          .send({ error: `Cleanverse could not issue the A-Pass: ${gen.message ?? gen.code}`, code: "APASS_FAILED" });
      }
      apassGenerated = true;
      cvRecordId = (gen.data as { cvRecordId?: string } | null)?.cvRecordId ?? null;
      try {
        await awaitApassUsable(address, { timeoutMs: 60_000 });
      } catch (err) {
        return reply.status(504).send({
          error: `A-Pass issued but not yet usable on-chain: ${(err as Error).message}`,
          code: "APASS_PENDING",
        });
      }
    }

    // Mirror the credential immediately so the wallet shows an up-to-date status before
    // the 30s poller next runs. Non-fatal if it fails — the poller is the real source.
    try {
      const db = requireSupabase();
      await db.from("holders").upsert(
        {
          wallet_address: lc(address),
          chain: "monad-testnet",
          has_apass: true,
          is_frozen: false,
          is_expired: false,
          apass_status: 1,
          customer_id: customerId,
          cv_record_id: cvRecordId,
          last_synced_at: new Date().toISOString(),
          sync_error: null,
        },
        { onConflict: "wallet_address" },
      );
    } catch {
      // best-effort mirror write
    }

    const mintCalldata = encodeFunctionData({
      abi: MINT_ABI,
      functionName: "mint",
      args: [address as `0x${string}`, amount],
    });

    return {
      address: lc(address),
      customerId,
      apassGenerated,
      cvRecordId,
      amount: amount.toString(),
      asset: CONTRACTS.tlnb,
      // The issuer's wallet signs this mint; the backend never holds a key.
      to: CONTRACTS.tlnb,
      mintCalldata,
    };
  });

  /**
   * A single wallet's full on-chain story: current identity + balance, plus a merged,
   * newest-first timeline of every event we index for it — mints, transfers, corporate
   * action payouts, and escrow deposits/releases.
   */
  app.get<{ Params: { wallet: string } }>("/holders/:wallet/history", async (req, reply) => {
    const wallet = req.params.wallet?.trim() ?? "";
    if (!isAddress(wallet)) {
      return reply.status(400).send({ error: "Invalid wallet address.", code: "BAD_ADDRESS" });
    }
    const w = lc(wallet);
    const db = requireSupabase();

    const [balanceRes, apassProbe, apassRecord, statusRow, transfersTo, transfersFrom, payouts, deposits, releases] =
      await Promise.all([
        publicClient
          .readContract({ address: CONTRACTS.tlnb, abi: BALANCE_ABI, functionName: "balanceOf", args: [w as `0x${string}`] })
          .catch(() => 0n),
        probeEligibility(wallet).catch(() => "no_apass" as const),
        cleanverse.queryApass("monad", wallet).catch(() => null),
        db.from("holders").select("*").eq("wallet_address", w).maybeSingle(),
        db.from("asset_transfers").select("*").eq("to_address", w),
        db.from("asset_transfers").select("*").eq("from_address", w),
        db.from("payout_events").select("*").eq("holder", w),
        db.from("escrow_deposits").select("*").eq("beneficiary", w),
        db.from("escrow_releases").select("*").eq("beneficiary", w),
      ]);

    const apassData =
      apassRecord && apassRecord.code === "0000" && apassRecord.data && typeof apassRecord.data === "object"
        ? (apassRecord.data as { status?: number; expirationTime?: number; cvRecordId?: string })
        : null;

    type Ev = {
      type: "mint" | "transfer_in" | "transfer_out" | "payout_paid" | "payout_escrowed" | "escrow_release";
      blockNumber: number;
      txHash: string;
      logIndex: number;
      amount: string;
      detail: Record<string, unknown>;
    };
    const events: Ev[] = [];

    for (const t of transfersTo.data ?? []) {
      const isMint = lc(t.from_address as string) === "0x0000000000000000000000000000000000000000";
      events.push({
        type: isMint ? "mint" : "transfer_in",
        blockNumber: Number(t.block_number),
        txHash: t.tx_hash as string,
        logIndex: t.log_index as number,
        amount: String(t.amount),
        detail: { from: t.from_address, asset: t.asset },
      });
    }
    for (const t of transfersFrom.data ?? []) {
      // A mint has from = 0x0, never this wallet, so transfers_from are all real sends.
      events.push({
        type: "transfer_out",
        blockNumber: Number(t.block_number),
        txHash: t.tx_hash as string,
        logIndex: t.log_index as number,
        amount: String(t.amount),
        detail: { to: t.to_address, asset: t.asset },
      });
    }
    for (const p of payouts.data ?? []) {
      events.push({
        type: p.outcome === "paid" ? "payout_paid" : "payout_escrowed",
        blockNumber: Number(p.block_number),
        txHash: p.tx_hash as string,
        logIndex: p.log_index as number,
        amount: String(p.amount),
        detail: { actionId: p.action_id, reasonSelector: p.reason_selector, offender: p.offender },
      });
    }
    for (const d of deposits.data ?? []) {
      events.push({
        type: "payout_escrowed",
        blockNumber: Number(d.block_number),
        txHash: d.tx_hash as string,
        logIndex: d.log_index as number,
        amount: String(d.amount),
        detail: { actionId: d.action_id, reasonSelector: d.reason_selector, offender: d.offender, escrowDeposit: true },
      });
    }
    for (const r of releases.data ?? []) {
      events.push({
        type: "escrow_release",
        blockNumber: Number(r.block_number),
        txHash: r.tx_hash as string,
        logIndex: r.log_index as number,
        amount: String(r.amount),
        detail: { inferredActionId: r.inferred_action_id, attributionCertain: r.attribution_certain },
      });
    }

    // De-dup: an escrowed leg appears as both a payout_event and an escrow_deposit for the
    // same (tx, logIndex family). Keep one row per (txHash, type, amount) — payout_events
    // and escrow_deposits share a tx hash for the same escrow, so collapse on tx+type.
    const seen = new Set<string>();
    const merged = events
      .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)
      .filter((e) => {
        const key = `${e.txHash}:${e.type}:${e.amount}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return {
      wallet: w,
      asset: CONTRACTS.tlnb,
      balance: (balanceRes as bigint).toString(),
      identity: {
        state: apassProbe,
        hasApass: apassData !== null,
        status: apassData?.status ?? null,
        expirationTime: apassData?.expirationTime ?? null,
        cvRecordId: apassData?.cvRecordId ?? (statusRow.data?.cv_record_id as string | null) ?? null,
        customerId: (statusRow.data?.customer_id as string | null) ?? null,
      },
      events: merged,
    };
  });

  /**
   * Register-wide dashboard aggregates: totals for holders, supply, identity states,
   * corporate actions, and value distributed/escrowed. DB + one reconcile pass — cheap
   * enough to serve on a page load.
   */
  app.get("/stats", async () => {
    const db = requireSupabase();
    const [recon, statusRows, actions, payouts, deposits, releases] = await Promise.all([
      reconcileCapTable(),
      db.from("holders").select("has_apass,is_frozen,is_expired,apass_status"),
      db.from("corporate_actions").select("status,total_amount"),
      db.from("payout_events").select("outcome,amount"),
      db.from("escrow_deposits").select("amount"),
      db.from("escrow_releases").select("amount"),
    ]);

    const rows = statusRows.data ?? [];
    const stateCounts = { active: 0, frozen: 0, expired: 0, no_apass: 0 };
    for (const r of rows) {
      if (!r.has_apass) stateCounts.no_apass++;
      else if (r.is_frozen) stateCounts.frozen++;
      else if (r.is_expired) stateCounts.expired++;
      else stateCounts.active++;
    }

    const actionRows = actions.data ?? [];
    const closed = actionRows.filter((a) => a.status === "Closed").length;

    const sum = (arr: { amount: unknown }[]) => arr.reduce((acc, x) => acc + BigInt(String(x.amount)), 0n);
    const totalPaid = sum((payouts.data ?? []).filter((p) => p.outcome === "paid"));
    const totalEscrowedEver = sum(deposits.data ?? []);
    const totalReleased = sum(releases.data ?? []);
    const currentlyEscrowed = totalEscrowedEver - totalReleased;

    return {
      asset: CONTRACTS.tlnb,
      capTable: {
        totalHolders: recon.holderCount,
        totalSupply: recon.totalSupply.toString(),
      },
      identity: stateCounts,
      actions: {
        total: actionRows.length,
        closed,
        open: actionRows.length - closed,
      },
      value: {
        totalPaid: totalPaid.toString(),
        currentlyEscrowed: (currentlyEscrowed < 0n ? 0n : currentlyEscrowed).toString(),
        totalReleased: totalReleased.toString(),
      },
    };
  });
}
