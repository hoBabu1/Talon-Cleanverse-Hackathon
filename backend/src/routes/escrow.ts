/**
 * The Omnibus ledger.
 *
 * Live balances are read FROM THE CHAIN (`beneficiariesOf` / `ledgerOf`), never summed from
 * the mirror. The deposit and release tables are a historical log — the chain's views cannot
 * reproduce history because ledger entries are removed on release — but the chain is what
 * says how much is owed right now.
 *
 * Two honesty rules are enforced here rather than left to the UI:
 *
 *  1. The escrow REASON always comes from the on-chain event, never from the current
 *     off-chain A-Pass state. A holder may have been escrowed while frozen and since become
 *     merely expired; the immutable record of why the transfer actually failed is what
 *     belongs in an audit trail.
 *
 *  2. Release attribution is FIFO-INFERRED and is labelled as such. `Released` carries no
 *     actionId — only `Deposited` does — so attributing a release to an action is a guess
 *     unless the beneficiary had escrow from exactly one action.
 */
import type { FastifyInstance } from "fastify";
import { parseAbi, type Address } from "viem";
import { publicClient, CONTRACTS, lc } from "../lib/chain.js";
import { requireSupabase } from "../lib/supabase.js";
import { classifyApassSelector, describeApassRevertClass, decodeViemRevertError } from "../lib/decodeRevert.js";

const VAULT_ABI = parseAbi([
  "function beneficiariesOf(address token, uint256 start, uint256 count) view returns (address[])",
  "function beneficiaryCount(address token) view returns (uint256)",
  "function ledgerOf(address beneficiary, address token) view returns (uint256)",
  "function totalHeldOf(address token) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const REASON_LABEL: Record<string, string> = {
  "0x322fde89": "FROZEN",
  "0xaecc0dbe": "EXPIRED",
  "0x4731ab32": "RETURNED_FALSE",
  "0x19957115": "UNKNOWN_REVERT",
};

export async function escrowRoutes(app: FastifyInstance) {
  app.get("/escrow", async () => {
    const db = requireSupabase();
    const token = CONTRACTS.aUSDC;

    // Live balances, straight from the chain. Paginated because the view is paginated —
    // an unbounded read is exactly what the contract's pagination exists to prevent.
    const count = await publicClient.readContract({
      address: CONTRACTS.vault,
      abi: VAULT_ABI,
      functionName: "beneficiaryCount",
      args: [token],
    });

    const beneficiaries: string[] = [];
    const PAGE = 100n;
    for (let start = 0n; start < count; start += PAGE) {
      const page = (await publicClient.readContract({
        address: CONTRACTS.vault,
        abi: VAULT_ABI,
        functionName: "beneficiariesOf",
        args: [token, start, PAGE],
      })) as readonly Address[];
      beneficiaries.push(...page.map(lc));
    }

    const live = await Promise.all(
      beneficiaries.map(async (b) => ({
        beneficiary: b,
        held: (
          await publicClient.readContract({
            address: CONTRACTS.vault,
            abi: VAULT_ABI,
            functionName: "ledgerOf",
            args: [b as Address, token],
          })
        ).toString(),
      })),
    );

    const { data: deposits } = await db
      .from("escrow_deposits")
      .select("*")
      .order("block_number", { ascending: false });
    const { data: releases } = await db
      .from("escrow_releases")
      .select("*")
      .order("block_number", { ascending: false });

    const rows = (deposits ?? []).map((d) => {
      // Decode the raw revert the CAM recorded. This is what lets a NoAPass failure read as
      // "No A-Pass" rather than unexplained hex, even though the frozen contract could only
      // tag it UNKNOWN_REVERT. The on-chain tag is still reported verbatim alongside it —
      // the decode annotates the record, it never replaces it.
      const decoded = d.raw_revert ? decodeViemRevertError({ raw: d.raw_revert }) : null;
      const cls = classifyApassSelector(decoded?.selector ?? d.reason_selector);

      return {
        txHash: d.tx_hash,
        logIndex: d.log_index,
        blockNumber: d.block_number,
        beneficiary: d.beneficiary,
        token: d.token,
        amount: d.amount,
        actionId: d.action_id,
        onChainReason: REASON_LABEL[d.reason_selector] ?? d.reason_selector,
        reasonSelector: d.reason_selector,
        offender: d.offender,
        rawRevert: d.raw_revert,
        decodedReason: cls,
        explanation: describeApassRevertClass(cls),
        // True when the contract could only say UNKNOWN_REVERT but the bytes are in fact
        // a reason we can name. Worth surfacing: an unclassified failure that still
        // protected the holder is a stronger demonstration than a clean frozen case.
        decodedBeyondOnChainTag: d.reason_selector === "0x19957115" && cls !== "other",
      };
    });

    const byBeneficiary = new Map<string, number[]>();
    for (const d of deposits ?? []) {
      const list = byBeneficiary.get(d.beneficiary) ?? [];
      if (!list.includes(d.action_id)) list.push(d.action_id);
      byBeneficiary.set(d.beneficiary, list);
    }

    const releaseRows = (releases ?? []).map((r) => {
      const actions = byBeneficiary.get(r.beneficiary) ?? [];
      const certain = actions.length === 1;
      return {
        txHash: r.tx_hash,
        blockNumber: r.block_number,
        beneficiary: r.beneficiary,
        amount: r.amount,
        trigger: r.trigger_address,
        inferredActionId: certain ? actions[0] : (r.inferred_action_id ?? null),
        // Never present an inference as a fact. This is the integrity the pitch trades on.
        attributionCertain: certain,
        attributionNote: certain
          ? "This beneficiary has escrow from exactly one action, so the attribution is certain."
          : "Released carries no actionId; attribution is FIFO-inferred, not recorded on-chain.",
      };
    });

    const counts = {
      escrowed: live.filter((l) => l.held !== "0").length,
      expired: rows.filter((r) => r.decodedReason === "expired").length,
      frozen: rows.filter((r) => r.decodedReason === "frozen").length,
      noApass: rows.filter((r) => r.decodedReason === "no_apass").length,
      unclassified: rows.filter((r) => r.decodedReason === "other").length,
      // The whole thesis in one number. It is structurally always zero: the contracts have
      // no forfeiture path at all, and adminForfeit was deliberately never built.
      forfeited: 0,
    };

    // The vault's core invariant, checked live against the real chain rather than only in
    // the fuzz suite: sum(ledger) <= balanceOf(vault). It is "<=" and not "==" on purpose —
    // anyone can donate tokens to the vault, and that surplus is recoverable via the
    // owner-only skim. A violation would mean the vault owes more than it holds.
    const [totalHeld, vaultBalance] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.vault, abi: VAULT_ABI, functionName: "totalHeldOf", args: [token],
      }),
      publicClient.readContract({
        address: token, abi: VAULT_ABI, functionName: "balanceOf", args: [CONTRACTS.vault],
      }),
    ]);

    return {
      token,
      counts,
      invariant: {
        totalHeld: totalHeld.toString(),
        vaultBalance: vaultBalance.toString(),
        surplus: (vaultBalance - totalHeld).toString(),
        holds: totalHeld <= vaultBalance,
        statement: "sum(ledger) <= balanceOf(vault)",
      },
      liveBalances: live,
      deposits: rows,
      releases: releaseRows,
    };
  });
}
