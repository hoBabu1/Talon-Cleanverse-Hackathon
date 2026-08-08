/**
 * Entitlement engine — record-date snapshot, pro-rata maths, and the commitment hash.
 *
 * The hash is the delicate part. `declareAction` commits a `holderSetHash`, and every
 * `executePayoutRun` chains into a `runningHash`; `closeAction` compares the two and
 * reverts with CoverageHashMismatch if they differ. A mismatch is therefore invisible
 * until the very end — after money has already moved. So the encoding here is transcribed
 * from the deployed contract's own source, not paraphrased, and pinned by a test that
 * reproduces a REAL on-chain action's hash.
 *
 *   seed  = keccak256(abi.encode(chainid, cam, actionId, token, asset, recordBlock))
 *   step  = keccak256(abi.encode(runningHash, holders, amounts))
 *
 * `abi.encode` — never `encodePacked`. Dynamic arrays encode as head offsets plus lengths,
 * so a naive concatenation produces a plausible-looking hash that is simply wrong.
 */
import { keccak256, encodeAbiParameters, parseAbi, type Address } from "viem";
import { publicClient, CONTRACTS, DEPLOY_BLOCKS, lc } from "./chain.js";
import { getCursor } from "../jobs/indexer.js";
import { indexedHolderSet } from "./reconcile.js";

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

/** Addresses that must never receive an entitlement, whatever their balance says. */
function structuralExclusion(address: string): ExclusionReason | null {
  const a = lc(address);
  if (a === "0x0000000000000000000000000000000000000000") return "zero_address";
  if (a === lc(CONTRACTS.vault)) return "vault";
  if (a === lc(CONTRACTS.cam)) return "manager";
  if (a === lc(CONTRACTS.tlnb) || a === lc(CONTRACTS.aUSDC)) return "token_self";
  return null;
}

export type ExclusionReason =
  | "rounds_to_zero"
  | "zero_address"
  | "vault"
  | "manager"
  | "token_self";

export interface SnapshotRow {
  holder: string;
  assetBalance: bigint;
  entitlement: bigint;
  included: boolean;
  exclusionReason: ExclusionReason | null;
}

export interface BatchPlan {
  batchIndex: number;
  holders: string[];
  amounts: bigint[];
  batchTotal: bigint;
  /** runningHash AFTER this batch is applied. */
  expectedHash: `0x${string}`;
}

export interface PreparedAction {
  actionId: bigint;
  token: Address;
  asset: Address;
  recordBlock: bigint;
  totalAmount: bigint;
  holderSetHash: `0x${string}`;
  totalHolders: number;
  rows: SnapshotRow[];
  excluded: SnapshotRow[];
  batches: BatchPlan[];
}

// ---------------------------------------------------------------------------
// Commitment hash
// ---------------------------------------------------------------------------

export function commitmentSeed(args: {
  chainId: bigint;
  cam: Address;
  actionId: bigint;
  token: Address;
  asset: Address;
  recordBlock: bigint;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [args.chainId, args.cam, args.actionId, args.token, args.asset, args.recordBlock],
    ),
  );
}

export function chainStep(
  runningHash: `0x${string}`,
  holders: readonly string[],
  amounts: readonly bigint[],
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address[]" }, { type: "uint256[]" }],
      [runningHash, holders as readonly Address[], amounts],
    ),
  );
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

/**
 * Machine-readable reasons a prepare can be refused.
 *
 * These are deliberately distinct from the actionId-clash 409 raised in the route. A stale
 * indexer and a taken actionId are both 409s and were both once described as "another
 * action was declared concurrently" — which is true of exactly one of them. Telling an
 * operator to retry when retrying cannot help is worse than saying nothing: it sends them
 * looking for a race that does not exist while the indexer quietly stays behind.
 */
export type PrepareErrorCode =
  | "STALE_INDEX"
  | "FUTURE_RECORD_BLOCK"
  | "ZERO_TOTAL_AMOUNT"
  | "ZERO_SUPPLY_AT_RECORD_BLOCK"
  | "NO_ELIGIBLE_HOLDERS"
  | "ISSUER_INSUFFICIENT_BALANCE";

export class PrepareError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code: PrepareErrorCode,
  ) {
    super(message);
    this.name = "PrepareError";
  }
}

export interface PrepareOptions {
  /** What holders are PAID in. */
  token?: Address;
  /** What the action is ABOUT. */
  asset?: Address;
  recordBlock: bigint;
  totalAmount: bigint;
  batchSize?: number;
  /** Skips the indexer-readiness gate. Only for reproducing a historical action. */
  allowStaleIndex?: boolean;
}

/**
 * Build the full snapshot, entitlements, and frozen batch plan for an action that has NOT
 * been declared yet. Nothing here touches the chain's state — it only reads.
 */
export async function prepareAction(opts: PrepareOptions): Promise<PreparedAction> {
  const token = opts.token ?? CONTRACTS.aUSDC;
  const asset = opts.asset ?? CONTRACTS.tlnb;
  const { recordBlock, totalAmount } = opts;
  const batchSize = opts.batchSize ?? 50;

  if (totalAmount <= 0n) {
    throw new PrepareError(400, "totalAmount must be greater than zero", "ZERO_TOTAL_AMOUNT");
  }

  // GATE 1 — the indexer must have seen the record block. Preparing against a partially
  // indexed holder set commits a WRONG set on-chain, immutably, and it surfaces only at
  // closeAction, long after money has moved.
  if (!opts.allowStaleIndex) {
    const cursor = await getCursor("tlnb", DEPLOY_BLOCKS.tlnb);
    if (cursor < recordBlock) {
      // Deliberately worded so it can never be mistaken for the actionId-clash 409. This is
      // not a race and retrying immediately will not help; the indexer has to catch up, and
      // the gap is stated in blocks so it is obvious whether that means seconds or minutes.
      throw new PrepareError(
        409,
        `Indexer is ${recordBlock - cursor} block(s) behind: it has scanned through block ` +
          `${cursor} but the record block is ${recordBlock}. Preparing now would commit an ` +
          `incomplete holder set on-chain. This is not an id conflict — run the indexer ` +
          `until its cursor reaches ${recordBlock}, then prepare again.`,
        "STALE_INDEX",
      );
    }
  }

  const head = await publicClient.getBlockNumber();
  if (recordBlock > head) {
    throw new PrepareError(
      400,
      `Record block ${recordBlock} is in the future (head ${head}).`,
      "FUTURE_RECORD_BLOCK",
    );
  }

  // Balances come from archive state at the record block, NOT reconstructed from logs.
  // Confirmed working on Monad's public RPC. Log enumeration gives the candidate SET;
  // reconstruction of balances would make one missed log corrupt everything after it.
  const candidates = await indexedHolderSet();
  const balances = await Promise.all(
    candidates.map(async (holder) => ({
      holder,
      assetBalance: await publicClient.readContract({
        address: asset,
        abi: ERC20,
        functionName: "balanceOf",
        args: [holder as Address],
        blockNumber: recordBlock,
      }),
    })),
  );

  const supplyAtRecord = await publicClient.readContract({
    address: asset,
    abi: ERC20,
    functionName: "totalSupply",
    blockNumber: recordBlock,
  });
  if (supplyAtRecord === 0n) {
    throw new PrepareError(
      409,
      `Asset ${asset} had zero supply at block ${recordBlock}.`,
      "ZERO_SUPPLY_AT_RECORD_BLOCK",
    );
  }

  // Pro-rata, floored. Integer division IS the floor, and the shortfall against
  // totalAmount is the dust that simply isn't distributed — deliberately not
  // redistributed, which would make the maths depend on iteration order.
  const rows: SnapshotRow[] = balances
    .map(({ holder, assetBalance }) => {
      const structural = structuralExclusion(holder);
      const entitlement = structural ? 0n : (assetBalance * totalAmount) / supplyAtRecord;
      const exclusionReason: ExclusionReason | null =
        structural ?? (entitlement === 0n ? "rounds_to_zero" : null);
      return {
        holder,
        assetBalance,
        entitlement,
        included: exclusionReason === null,
        exclusionReason,
      };
    })
    // Deterministic order. The hash depends on intra-batch order, so this must never
    // depend on the order Postgres happened to return rows in.
    .sort((a, b) =>
      b.assetBalance === a.assetBalance
        ? a.holder.localeCompare(b.holder)
        : b.assetBalance > a.assetBalance
          ? 1
          : -1,
    );

  const included = rows.filter((r) => r.included);
  const excluded = rows.filter((r) => !r.included);

  if (included.length === 0) {
    throw new PrepareError(
      409,
      "No holder has a non-zero entitlement at this record block.",
      "NO_ELIGIBLE_HOLDERS",
    );
  }

  // GATE 2 — budget. executePayoutRun preflights the issuer's balance and reverts the
  // WHOLE batch, so an over-budget action fails on stage rather than at prepare time.
  const sumEntitlements = included.reduce((a, r) => a + r.entitlement, 0n);
  const issuer = await publicClient.readContract({
    address: CONTRACTS.cam,
    abi: parseAbi(["function owner() view returns (address)"]),
    functionName: "owner",
  });
  const issuerBalance = await publicClient.readContract({
    address: token,
    abi: ERC20,
    functionName: "balanceOf",
    args: [issuer],
  });
  if (sumEntitlements > issuerBalance) {
    throw new PrepareError(
      409,
      `Entitlements total ${sumEntitlements} but the issuer holds only ${issuerBalance} ` +
        `of the payment token. executePayoutRun would revert the entire batch.`,
      "ISSUER_INSUFFICIENT_BALANCE",
    );
  }

  // actionId must be PREDICTED because it is inside the seed. It is verified against the
  // ActionDeclared receipt before any execution is allowed.
  const actionId = await publicClient.readContract({
    address: CONTRACTS.cam,
    abi: parseAbi(["function actionsCount() view returns (uint256)"]),
    functionName: "actionsCount",
  });

  const batches = buildBatches({
    actionId,
    token,
    asset,
    recordBlock,
    included,
    batchSize,
  });

  return {
    actionId,
    token,
    asset,
    recordBlock,
    totalAmount,
    holderSetHash: batches[batches.length - 1].expectedHash,
    totalHolders: included.length,
    rows,
    excluded,
    batches,
  };
}

export function buildBatches(args: {
  actionId: bigint;
  token: Address;
  asset: Address;
  recordBlock: bigint;
  included: Pick<SnapshotRow, "holder" | "entitlement">[];
  batchSize: number;
  chainId?: bigint;
  cam?: Address;
}): BatchPlan[] {
  const chainId = args.chainId ?? BigInt(publicClient.chain!.id);
  const cam = args.cam ?? CONTRACTS.cam;

  let running = commitmentSeed({
    chainId,
    cam,
    actionId: args.actionId,
    token: args.token,
    asset: args.asset,
    recordBlock: args.recordBlock,
  });

  const batches: BatchPlan[] = [];
  for (let i = 0; i < args.included.length; i += args.batchSize) {
    const slice = args.included.slice(i, i + args.batchSize);
    const holders = slice.map((r) => r.holder);
    const amounts = slice.map((r) => r.entitlement);
    running = chainStep(running, holders, amounts);
    batches.push({
      batchIndex: batches.length,
      holders,
      amounts,
      batchTotal: amounts.reduce((a, b) => a + b, 0n),
      expectedHash: running,
    });
  }
  return batches;
}
