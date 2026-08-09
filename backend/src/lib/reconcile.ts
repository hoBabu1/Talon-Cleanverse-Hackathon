/**
 * Cap-table reconciliation — an ONGOING health check, not a one-time proof.
 *
 * The cap table is built in two halves that fail in different ways:
 *
 *   - the holder SET comes from indexed Transfer logs, and
 *   - each balance comes from `balanceOf` on-chain.
 *
 * That split is deliberate (a missed log costs you one holder, whereas reconstructing
 * balances from logs makes every later balance silently wrong). But it leaves exactly one
 * hole: if a Transfer log is missed, the holder never enters the set, and nothing about
 * the remaining rows looks wrong. Every balance shown is individually correct and the
 * total is quietly short.
 *
 * The check that catches it is summing on-chain balances ACROSS THE INDEXED SET and
 * comparing to `totalSupply`. A missing holder shows up immediately as a shortfall. This
 * is the difference between a dashboard that is right and one that merely renders.
 *
 * Run it continuously and expose it, so drift is discovered by us rather than by a judge.
 */
import { parseAbi, type ContractFunctionParameters } from "viem";
import { publicClient, CONTRACTS, DEPLOY_BLOCKS, lc } from "./chain.js";
import { requireSupabase } from "./supabase.js";
import { getCursor } from "../jobs/indexer.js";

const ERC20 = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

/** Addresses that hold supply but are not holders in any meaningful sense. */
const NON_HOLDERS = new Set([
  "0x0000000000000000000000000000000000000000",
  lc(CONTRACTS.vault),
  lc(CONTRACTS.cam),
  lc(CONTRACTS.tlnb),
]);

export interface HolderBalance {
  address: string;
  balance: bigint;
}

export interface Reconciliation {
  ok: boolean;
  asset: string;
  totalSupply: bigint;
  /** Sum of on-chain balanceOf across every address the indexer knows about. */
  indexedSum: bigint;
  /** totalSupply - indexedSum. Non-zero means the holder set is incomplete. */
  shortfall: bigint;
  holderCount: number;
  /** Holders with a non-zero balance, largest first. */
  holders: HolderBalance[];
  /** How far the indexer's cursor is behind chain head, in blocks. */
  cursorLagBlocks: bigint;
  headBlock: bigint;
  /** Present only when something is wrong; safe to render directly. */
  problem?: string;
}

/**
 * Every address that has ever appeared as a Transfer counterparty, which is the complete
 * candidate set: a wallet cannot hold tokens without having received them.
 */
export async function indexedHolderSet(): Promise<string[]> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("asset_transfers")
    .select("from_address, to_address")
    .eq("asset", lc(CONTRACTS.tlnb));
  if (error) throw new Error(`holder set read failed: ${error.message}`);

  const set = new Set<string>();
  for (const row of data ?? []) {
    for (const a of [row.from_address as string, row.to_address as string]) {
      const addr = lc(a);
      if (!NON_HOLDERS.has(addr)) set.add(addr);
    }
  }
  return [...set];
}

/**
 * How long a reconciliation stays reusable.
 *
 * Short enough that the cap table is never meaningfully stale, long enough that one page
 * load doesn't recompute it three times — `/holders`, `/stats` and `/health` each call
 * this, and the frontend requests all three at once.
 */
const RECONCILE_TTL_MS = 5_000;

let cachedAt = 0;
let cachedValue: Reconciliation | null = null;
let inFlight: Promise<Reconciliation> | null = null;

/**
 * Reconcile the cap table, reusing a recent result rather than re-reading the chain.
 *
 * The cache exists because of a real production failure, not as premature optimization:
 * three routes each called this on every page load, each firing 11 parallel `eth_call`s,
 * and Monad's public RPC caps at **15 requests per second — counted per call, not per HTTP
 * request** (verified: a 30-call JSON-RPC batch returns exactly 15 results and 15
 * `requests limited to 15/sec` errors, so batching alone does not help). The deployed
 * backend answered 500 for `/holders`, `/stats` and `/vault-health`.
 *
 * `inFlight` matters as much as the TTL. Three simultaneous callers on a cold cache would
 * each start their own reconciliation and reproduce the burst exactly; instead they await
 * the same one.
 *
 * `fresh` bypasses both, for `/debug/reconcile` — a debug route that returned a cached
 * answer would be useless for the one job it has.
 */
export async function reconcileCapTable(opts: { fresh?: boolean } = {}): Promise<Reconciliation> {
  if (!opts.fresh) {
    if (cachedValue && Date.now() - cachedAt < RECONCILE_TTL_MS) return cachedValue;
    if (inFlight) return inFlight;
  }

  const run = computeReconciliation().then((value) => {
    cachedValue = value;
    cachedAt = Date.now();
    return value;
  });

  if (!opts.fresh) {
    inFlight = run;
    // Only clear the slot if it is still ours — a concurrent `fresh` call must not null
    // out the shared promise that other callers are waiting on.
    void run.finally(() => {
      if (inFlight === run) inFlight = null;
    });
  }
  return run;
}

async function computeReconciliation(): Promise<Reconciliation> {
  const asset = CONTRACTS.tlnb;
  const [headBlock, addresses] = await Promise.all([
    publicClient.getBlockNumber(),
    indexedHolderSet(),
  ]);

  // totalSupply + every holder balance in ONE eth_call.
  //
  // This was previously one read per holder, with a comment reasoning that depending on a
  // Multicall3 deployment on Monad testnet would trade a real dependency for an invisible
  // saving. Both halves of that turned out to be wrong: Multicall3 IS deployed at the
  // canonical address (confirmed by eth_getCode, see chain.ts), and the saving is not
  // invisible — it is 11 RPC calls versus 2, against a 15/sec ceiling.
  // Annotated rather than inferred: TS infers the element type from the first entry
  // ("totalSupply") and then rejects the "balanceOf" spread.
  const contracts: ContractFunctionParameters[] = [
    { address: asset, abi: ERC20, functionName: "totalSupply" },
    ...addresses.map((address) => ({
      address: asset,
      abi: ERC20,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    })),
  ];

  const results = await publicClient.multicall({
    contracts,
    // A partial cap table is the failure this whole module exists to catch, so a failed
    // read must throw rather than quietly reconcile against fewer holders.
    allowFailure: false,
  });

  const totalSupply = results[0] as bigint;
  const balances = addresses.map((address, i) => ({
    address,
    balance: results[i + 1] as bigint,
  }));

  const indexedSum = balances.reduce((a, b) => a + b.balance, 0n);
  const shortfall = totalSupply - indexedSum;
  const cursorLagBlocks = headBlock - (await getCursor("tlnb", DEPLOY_BLOCKS.tlnb));

  const holders = balances
    .filter((b) => b.balance > 0n)
    .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));

  let problem: string | undefined;
  if (shortfall > 0n) {
    problem =
      `Cap table is short ${shortfall} units against a total supply of ${totalSupply}. ` +
      `At least one holder is missing from the indexed set — the displayed cap table is incomplete.`;
  } else if (shortfall < 0n) {
    // Structurally near-impossible (it would mean double-counting an address), but a
    // silent negative here would be worse than a loud one.
    problem =
      `Indexed balances exceed total supply by ${-shortfall} units, which should be ` +
      `impossible and indicates an address counted twice.`;
  }

  return {
    ok: shortfall === 0n,
    asset,
    totalSupply,
    indexedSum,
    shortfall,
    holderCount: holders.length,
    holders,
    cursorLagBlocks,
    headBlock,
    problem,
  };
}

/** JSON-safe projection — bigints don't survive JSON.stringify. */
export function serializeReconciliation(r: Reconciliation) {
  return {
    ok: r.ok,
    asset: r.asset,
    totalSupply: r.totalSupply.toString(),
    indexedSum: r.indexedSum.toString(),
    shortfall: r.shortfall.toString(),
    holderCount: r.holderCount,
    holders: r.holders.map((h) => ({ address: h.address, balance: h.balance.toString() })),
    cursorLagBlocks: Number(r.cursorLagBlocks),
    headBlock: r.headBlock.toString(),
    ...(r.problem ? { problem: r.problem } : {}),
  };
}
