/**
 * Cap table and vault health.
 *
 * Balances come from the chain; A-Pass state comes from the mirror the poller maintains.
 * That split is deliberate — balances are cheap and authoritative on-chain, whereas A-Pass
 * state costs two Cleanverse calls per holder and must not be fetched inside a page render.
 *
 * Staleness is returned as data, not hidden. If the poller has stopped, the UI is supposed
 * to say "last known state as of HH:MM:SS" rather than present old rows as current.
 */
import type { FastifyInstance } from "fastify";
import { parseAbi } from "viem";
import { publicClient, CONTRACTS } from "../lib/chain.js";
import { requireSupabase } from "../lib/supabase.js";
import { reconcileCapTable, serializeReconciliation } from "../lib/reconcile.js";
import { probeEligibility } from "../lib/eligibility.js";
import { cleanverse } from "../lib/cleanverse.js";

/** Rows older than this are surfaced as stale. */
const STALE_AFTER_MS = 90_000;

export async function holderRoutes(app: FastifyInstance) {
  app.get("/holders", async () => {
    const db = requireSupabase();
    const recon = await reconcileCapTable();

    const { data: statusRows } = await db.from("holders").select("*");
    const byWallet = new Map((statusRows ?? []).map((r) => [r.wallet_address as string, r]));

    const now = Date.now();
    const holders = recon.holders.map((h) => {
      const s = byWallet.get(h.address);
      const syncedAt = s?.last_synced_at ? new Date(s.last_synced_at).getTime() : null;
      const stale = syncedAt === null || now - syncedAt > STALE_AFTER_MS;

      return {
        wallet: h.address,
        balance: h.balance.toString(),
        // Five display states, never four. A wallet with no A-Pass must not render as
        // Active — query_apass returns an empty STRING for it, so every naive truthiness
        // check reads false and the holder silently looks fine.
        displayState: s ? deriveState(s) : "unknown",
        hasApass: s?.has_apass ?? null,
        isFrozen: s?.is_frozen ?? null,
        isExpired: s?.is_expired ?? null,
        expirationTime: s?.expiration_time ?? null,
        verifyCode: s?.verify_code ?? null,
        lastSyncedAt: s?.last_synced_at ?? null,
        syncError: s?.sync_error ?? null,
        stale,
      };
    });

    return {
      asset: CONTRACTS.tlnb,
      holders,
      reconciliation: serializeReconciliation(recon),
      // One flag the UI can hang the staleness banner off, rather than each row deciding.
      anyStale: holders.some((h) => h.stale),
    };
  });

  /**
   * The vault's own A-Pass.
   *
   * A-Tokens check the SENDER's eligibility too, so if the vault's credential ever lapsed
   * every beneficiary's claim would break at once — through no fault of theirs, and with a
   * revert naming the vault rather than the holder. Worth a banner long before it happens.
   */
  app.get("/vault-health", async () => {
    const [probe, apass] = await Promise.all([
      probeEligibility(CONTRACTS.vault).catch((e) => ({ state: "inconclusive" as const, detail: String(e) })),
      cleanverse.queryApass("monad", CONTRACTS.vault).catch(() => null),
    ]);

    const record =
      apass && apass.code === "0000" && apass.data && typeof apass.data === "object"
        ? (apass.data as { status?: number; expirationTime?: number })
        : null;

    const expiresAt = record?.expirationTime ?? null;
    const daysLeft = expiresAt ? Math.floor((expiresAt * 1000 - Date.now()) / 86_400_000) : null;

    const held = await publicClient.readContract({
      address: CONTRACTS.aUSDC,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [CONTRACTS.vault],
    });

    return {
      vault: CONTRACTS.vault,
      eligibility: typeof probe === "object" && "state" in probe ? probe.state : probe,
      apassStatus: record?.status ?? null,
      expiresAt,
      daysLeft,
      aUSDCHeld: held.toString(),
      healthy: (typeof probe === "object" && "state" in probe ? probe.state : probe) === "active",
    };
  });
}

function deriveState(s: Record<string, unknown>): string {
  if (s.has_apass === false) return "no_apass";
  if (s.is_frozen) return "frozen";
  if (s.is_expired) return "expired";
  return "active";
}
