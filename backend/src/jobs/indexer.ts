/**
 * The on-chain indexer.
 *
 * Populates the read-mirror in Supabase from three log streams: TLNB Transfer (the cap
 * table's holder set), the EscrowVault's Deposited/Released, and the manager's five
 * corporate-action events. The chain remains the source of truth throughout — nothing
 * here is ever consulted to decide whether someone gets paid.
 *
 * Three properties this is built around, in order of how badly they bite:
 *
 *  1. CRASH SAFETY. The cursor advances only AFTER a page's rows are committed. Crash in
 *     between and the page is simply rescanned. That is safe because every write is keyed
 *     on (tx_hash, log_index) and inserted with ignoreDuplicates, so at-least-once
 *     delivery produces exactly-once state. The cursor is never advanced optimistically
 *     and never rewound, so a restart can neither re-scan from the deploy block nor skip
 *     a gap.
 *
 *  2. LOWERCASE ADDRESSES, ALWAYS. viem returns checksummed addresses; raw logs return
 *     lowercase. The DB CHECK constraints reject anything not lowercase, which is the
 *     correct place to fail — but every address is normalised through `lc()` on the way
 *     in so that failure never actually happens one row at a time in production.
 *
 *  3. RAW REVERT BYTES ARE PRESERVED. HolderEscrowed carries the raw revert, and it is
 *     what lets the UI decode NoAPass (0xa6725971) and name a third escrow reason
 *     precisely, even though the frozen contract can only tag it REASON_UNKNOWN_REVERT.
 *     Dropping that column would turn a specific, explainable case back into unexplained
 *     hex.
 */
import { parseAbiItem, type AbiEvent, type Address, type Log } from "viem";
import { publicClient, CONTRACTS, DEPLOY_BLOCKS, lc } from "../lib/chain.js";
import { paginatedGetLogsForEvents } from "../lib/paginatedGetLogs.js";
import { requireSupabase } from "../lib/supabase.js";

// ---------------------------------------------------------------------------
// Event ABIs — transcribed from the DEPLOYED contracts' generated ABI files.
// ---------------------------------------------------------------------------

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/// `getAction` returns the whole CorporateAction struct. Needed because `runningHash` and
/// `nextIndex` are readable ONLY here — no event emits either.
const GET_ACTION_ABI = [
  parseAbiItem(
    "function getAction(uint256 actionId) view returns ((address token, address asset, uint256 recordBlock, uint256 totalAmount, uint256 remainingBudget, bytes32 holderSetHash, bytes32 runningHash, uint32 nextIndex, uint32 totalHolders, uint32 paidCount, uint32 escrowedCount, uint64 redirectAfter, uint8 status))",
  ),
] as const;

/// Mirrors the on-chain ActionStatus enum. Index 0 (None) is deliberately absent: it means
/// the action does not exist, which is not a status to persist.
const ACTION_STATUS: Record<number, string> = { 1: "Declared", 2: "Executing", 3: "Closed" };

const DEPOSITED = parseAbiItem(
  "event Deposited(address indexed beneficiary, address indexed token, uint256 amount, uint256 indexed actionId, bytes4 reasonSelector, address offender)",
);
const RELEASED = parseAbiItem(
  "event Released(address indexed beneficiary, address indexed token, uint256 amount, address trigger)",
);

const ACTION_DECLARED = parseAbiItem(
  "event ActionDeclared(uint256 indexed actionId, address indexed token, address indexed asset, uint256 recordBlock, uint256 totalAmount, bytes32 holderSetHash, uint32 totalHolders)",
);
const HOLDER_PAID = parseAbiItem(
  "event HolderPaid(uint256 indexed actionId, address indexed holder, uint256 amount)",
);
const HOLDER_ESCROWED = parseAbiItem(
  "event HolderEscrowed(uint256 indexed actionId, address indexed holder, uint256 amount, bytes4 reasonSelector, bytes rawRevert)",
);
const BATCH_EXECUTED = parseAbiItem(
  "event BatchExecuted(uint256 indexed actionId, uint256 batchIndex, uint32 processed, uint32 paid, uint32 escrowed)",
);
const ACTION_CLOSED = parseAbiItem(
  "event ActionClosed(uint256 indexed actionId, uint32 paid, uint32 escrowed, uint256 unspent, bool coverageComplete)",
);

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

/**
 * Last fully-scanned block for a stream. Returns `floor - 1` when absent, so the first
 * scan starts exactly AT the deploy block (callers scan from cursor + 1) rather than one
 * block after it — an off-by-one here would silently drop a contract's very first event.
 */
export async function getCursor(name: string, floor: bigint): Promise<bigint> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("indexer_cursor")
    .select("last_block")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(`cursor read failed for ${name}: ${error.message}`);
  return data ? BigInt(data.last_block as string | number) : floor - 1n;
}

async function setCursor(name: string, lastBlock: bigint): Promise<void> {
  const db = requireSupabase();
  const { error } = await db
    .from("indexer_cursor")
    .upsert({ name, last_block: Number(lastBlock), updated_at: new Date().toISOString() });
  if (error) throw new Error(`cursor write failed for ${name}: ${error.message}`);
}

/**
 * Idempotent insert. `ignoreDuplicates` makes a rescanned page a no-op rather than an
 * error, which is what allows the cursor to lag behind the writes safely.
 */
async function insertIgnoringDupes(table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  const db = requireSupabase();
  const { error } = await db.from(table).upsert(rows, { ignoreDuplicates: true });
  if (error) throw new Error(`insert into ${table} failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Log decoding helpers
// ---------------------------------------------------------------------------

type DecodedLog = Log & { eventName?: string; args?: Record<string, unknown> };

/** Every row shares this identity; it is also the idempotency key. */
function identity(log: DecodedLog) {
  return {
    tx_hash: lc(log.transactionHash!),
    log_index: log.logIndex!,
    block_number: Number(log.blockNumber!),
  };
}

function str(v: unknown): string {
  return String(v);
}

// ---------------------------------------------------------------------------
// Streams
// ---------------------------------------------------------------------------

/**
 * TLNB Transfer -> asset_transfers.
 *
 * These logs enumerate the holder SET only. Balances are deliberately NOT reconstructed
 * from them: archive state works on Monad's public RPC, so balances come from balanceOf
 * at the record block. Enumeration tolerates a missed log (a holder just doesn't appear);
 * event-sourced reconstruction does not — one missed log makes every later balance
 * silently wrong.
 */
async function handleAssetTransfers(logs: DecodedLog[]) {
  const rows = logs.map((log) => ({
    ...identity(log),
    asset: lc(CONTRACTS.tlnb),
    from_address: lc(str(log.args?.from)),
    to_address: lc(str(log.args?.to)),
    amount: str(log.args?.value),
  }));
  await insertIgnoringDupes("asset_transfers", rows);
}

async function handleVaultLogs(logs: DecodedLog[]) {
  const deposits = logs
    .filter((l) => l.eventName === "Deposited")
    .map((log) => ({
      ...identity(log),
      beneficiary: lc(str(log.args?.beneficiary)),
      token: lc(str(log.args?.token)),
      amount: str(log.args?.amount),
      action_id: Number(log.args?.actionId),
      reason_selector: str(log.args?.reasonSelector),
      offender: log.args?.offender ? lc(str(log.args.offender)) : null,
    }));

  // Released carries NO actionId — only Deposited does. Attribution is therefore a FIFO
  // inference and is recorded as one. It is resolved in a second pass below, once the
  // deposits from this same page are committed.
  const releases = logs
    .filter((l) => l.eventName === "Released")
    .map((log) => ({
      ...identity(log),
      beneficiary: lc(str(log.args?.beneficiary)),
      token: lc(str(log.args?.token)),
      amount: str(log.args?.amount),
      trigger_address: lc(str(log.args?.trigger)),
    }));

  await insertIgnoringDupes("escrow_deposits", deposits);
  await insertIgnoringDupes("escrow_releases", releases);

  for (const r of releases) await attributeRelease(r.tx_hash, r.log_index, r.beneficiary, r.token);
}

/**
 * Best-effort FIFO attribution of a release to an action.
 *
 * `attribution_certain` is true ONLY when the beneficiary has escrow deposits from
 * exactly one action, in which case the attribution is a fact rather than a guess. In
 * every other case the inference is stored but flagged, and the UI must render it as
 * inferred. Presenting an inference as a fact is precisely the integrity failure this
 * project exists to argue against.
 */
async function attributeRelease(
  txHash: string,
  logIndex: number,
  beneficiary: string,
  token: string,
) {
  const db = requireSupabase();
  const { data, error } = await db
    .from("escrow_deposits")
    .select("action_id, block_number")
    .eq("beneficiary", beneficiary)
    .eq("token", token)
    .order("block_number", { ascending: true });
  if (error) throw new Error(`release attribution read failed: ${error.message}`);

  const actionIds = [...new Set((data ?? []).map((d) => Number(d.action_id)))];
  if (actionIds.length === 0) return;

  const { error: upErr } = await db
    .from("escrow_releases")
    .update({
      inferred_action_id: actionIds[0], // FIFO: oldest outstanding deposit
      attribution_certain: actionIds.length === 1,
    })
    .eq("tx_hash", txHash)
    .eq("log_index", logIndex);
  if (upErr) throw new Error(`release attribution write failed: ${upErr.message}`);
}

async function handleCamLogs(logs: DecodedLog[]) {
  const db = requireSupabase();

  // --- payout legs -------------------------------------------------------
  const paid = logs
    .filter((l) => l.eventName === "HolderPaid")
    .map((log) => ({
      ...identity(log),
      action_id: Number(log.args?.actionId),
      holder: lc(str(log.args?.holder)),
      amount: str(log.args?.amount),
      outcome: "paid" as const,
      reason_selector: null,
      offender: null,
      raw_revert: null,
    }));

  const escrowed = logs
    .filter((l) => l.eventName === "HolderEscrowed")
    .map((log) => ({
      ...identity(log),
      action_id: Number(log.args?.actionId),
      holder: lc(str(log.args?.holder)),
      amount: str(log.args?.amount),
      outcome: "escrowed" as const,
      reason_selector: str(log.args?.reasonSelector),
      offender: null, // the vault's Deposited event is where the offender is recorded
      // The raw bytes are what let the UI decode NoAPass and show a precise third
      // reason even though the frozen contract could only tag UNKNOWN_REVERT.
      raw_revert: log.args?.rawRevert ? str(log.args.rawRevert) : null,
    }));

  await insertIgnoringDupes("payout_events", [...paid, ...escrowed]);

  // --- action lifecycle --------------------------------------------------
  // These are upserts on a mutable row rather than append-only event rows, so they are
  // applied in block order and always re-read from getAction() afterwards by the
  // reconcile step. The chain view, not this mirror, gates execution.
  for (const log of logs.filter((l) => l.eventName === "ActionDeclared")) {
    const a = log.args!;
    const { error } = await db.from("corporate_actions").upsert({
      action_id: Number(a.actionId),
      payment_token: lc(str(a.token)),
      asset: lc(str(a.asset)),
      record_block: Number(a.recordBlock),
      total_amount: str(a.totalAmount),
      holder_set_hash: str(a.holderSetHash),
      total_holders: Number(a.totalHolders),
      status: "Declared",
      declare_tx_hash: lc(log.transactionHash!),
    });
    if (error) throw new Error(`corporate_actions upsert failed: ${error.message}`);
  }

  for (const log of logs.filter((l) => l.eventName === "BatchExecuted")) {
    const a = log.args!;
    const { error } = await db
      .from("corporate_actions")
      .update({ status: "Executing" })
      .eq("action_id", Number(a.actionId))
      .neq("status", "Closed"); // never resurrect a closed action
    if (error) throw new Error(`corporate_actions batch update failed: ${error.message}`);

    const { error: bErr } = await db
      .from("action_batches")
      .update({ tx_hash: lc(log.transactionHash!), executed_at: new Date().toISOString() })
      .eq("action_id", Number(a.actionId))
      .eq("batch_index", Number(a.batchIndex));
    if (bErr) throw new Error(`action_batches update failed: ${bErr.message}`);
  }

  for (const log of logs.filter((l) => l.eventName === "ActionClosed")) {
    const a = log.args!;
    const { error } = await db
      .from("corporate_actions")
      .update({
        status: "Closed",
        paid_count: Number(a.paid),
        escrowed_count: Number(a.escrowed),
        coverage_complete: Boolean(a.coverageComplete),
        closed_at: new Date().toISOString(),
      })
      .eq("action_id", Number(a.actionId));
    if (error) throw new Error(`corporate_actions close update failed: ${error.message}`);
  }

  // Whatever the events could not tell us, read from the chain itself.
  const touched = new Set<number>();
  for (const log of logs) {
    const id = (log.args as { actionId?: bigint } | undefined)?.actionId;
    if (id !== undefined) touched.add(Number(id));
  }
  if (touched.size) await syncActionsFromChain([...touched]);
}

/**
 * Re-read authoritative action state from `getAction()` and sync the fields no event
 * carries.
 *
 * `runningHash` and `nextIndex` are the important ones: neither is ever emitted, so a
 * purely event-sourced mirror leaves `running_hash` permanently null. That matters
 * because `runningHash == holderSetHash` is the commitment-parity proof — the single
 * check `closeAction` performs — and the UI should be able to show it without a chain
 * round-trip on every render.
 *
 * This is a read of the source of truth, not a second opinion: on any disagreement
 * between these values and anything derived from events, the chain wins by definition.
 */
export async function syncActionsFromChain(actionIds: number[]): Promise<void> {
  const db = requireSupabase();

  for (const id of actionIds) {
    const a = (await publicClient.readContract({
      address: CONTRACTS.cam,
      abi: GET_ACTION_ABI,
      functionName: "getAction",
      args: [BigInt(id)],
    })) as {
      recordBlock: bigint;
      totalAmount: bigint;
      holderSetHash: `0x${string}`;
      runningHash: `0x${string}`;
      nextIndex: number;
      totalHolders: number;
      paidCount: number;
      escrowedCount: number;
      status: number;
    };

    // status 0 = None: the id doesn't exist on-chain, so there is nothing authoritative
    // to copy and writing zeros would fabricate state.
    if (a.status === 0) continue;

    const { error } = await db
      .from("corporate_actions")
      .update({
        running_hash: a.runningHash,
        next_index: a.nextIndex,
        paid_count: a.paidCount,
        escrowed_count: a.escrowedCount,
        status: ACTION_STATUS[a.status] ?? "Declared",
        // Derived exactly as closeAction derives it, from chain values only. Kept in sync
        // here as well as on ActionClosed so an action mid-run shows honest progress
        // rather than a stale null.
        coverage_complete: a.nextIndex === a.totalHolders && a.runningHash === a.holderSetHash,
      })
      .eq("action_id", id)
      // A 'Prepared' row is a PLAN, and promoting it here would attach an on-chain status to
      // a row with no declaring transaction behind it — the exact shape that bricked
      // /actions/prepare. Promotion out of 'Prepared' belongs solely to the ActionDeclared
      // handler below, which has the tx hash to prove it. This read of chain truth still
      // wins for every already-declared row; it just isn't allowed to invent provenance.
      .neq("status", "Prepared");
    if (error) throw new Error(`syncActionsFromChain(${id}) failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface Stream {
  name: string;
  address: Address;
  floor: bigint;
  events: AbiEvent[];
  handle: (logs: DecodedLog[]) => Promise<void>;
}

const STREAMS: Stream[] = [
  {
    name: "tlnb",
    address: CONTRACTS.tlnb,
    floor: DEPLOY_BLOCKS.tlnb,
    events: [TRANSFER],
    handle: handleAssetTransfers,
  },
  {
    name: "vault",
    address: CONTRACTS.vault,
    floor: DEPLOY_BLOCKS.vault,
    events: [DEPOSITED, RELEASED],
    handle: handleVaultLogs,
  },
  {
    name: "cam",
    address: CONTRACTS.cam,
    floor: DEPLOY_BLOCKS.cam,
    events: [ACTION_DECLARED, HOLDER_PAID, HOLDER_ESCROWED, BATCH_EXECUTED, ACTION_CLOSED],
    handle: handleCamLogs,
  },
];

export interface StreamResult {
  name: string;
  fromBlock: bigint;
  toBlock: bigint;
  logs: number;
}

/** One catch-up pass over every stream. Safe to call repeatedly; safe to kill mid-run. */
export async function runIndexerOnce(
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<StreamResult[]> {
  // `cacheTime: 0` is load-bearing, not tidiness. viem caches eth_blockNumber for
  // `client.cacheTime`, which defaults to the 4s polling interval — so a plain
  // getBlockNumber() here can return a head from BEFORE a transaction that has already
  // mined, and this pass then declines to scan the block containing it. In continuous mode
  // that self-corrects on the next tick and is invisible. It is not invisible to anything
  // that indexes once and immediately reads the mirror, which is precisely what the
  // cross-layer flow test does — and it is how a correct mirror was made to look stale.
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const results: StreamResult[] = [];

  for (const stream of STREAMS) {
    const cursor = await getCursor(stream.name, stream.floor);
    const fromBlock = cursor + 1n;
    if (fromBlock > head) {
      results.push({ name: stream.name, fromBlock, toBlock: head, logs: 0 });
      continue;
    }

    let count = 0;
    // A backfill runs 100 blocks at a time, so a cursor a million blocks behind stays
    // inside this call for a very long while. Without a heartbeat the only two things a
    // reader sees are "started" and, much later, "finished" — indistinguishable from a
    // hang. Throttled to one line per 15s so a quiet backfill can't flood the log.
    let lastBeat = Date.now();
    await paginatedGetLogsForEvents({
      address: stream.address,
      events: stream.events,
      fromBlock,
      toBlock: head,
      onPage: async (lastBlockScanned, pageLogs) => {
        // Order matters and is the crash-safety guarantee: rows first, cursor second.
        // Reversing these two lines would let a crash advance past unwritten logs, and
        // nothing downstream would ever notice the hole.
        await stream.handle(pageLogs as DecodedLog[]);
        await setCursor(stream.name, lastBlockScanned);
        count += pageLogs.length;
        if (pageLogs.length) {
          opts.onProgress?.(
            `  ${stream.name}: +${pageLogs.length} logs through block ${lastBlockScanned}`,
          );
          lastBeat = Date.now();
        } else if (Date.now() - lastBeat > 15_000) {
          lastBeat = Date.now();
          opts.onProgress?.(
            `  ${stream.name}: scanning — at block ${lastBlockScanned}, ${head - lastBlockScanned} behind head`,
          );
        }
      },
    });

    results.push({ name: stream.name, fromBlock, toBlock: head, logs: count });
  }

  return results;
}

/**
 * Continuous mode. Errors are logged and retried rather than killing the loop.
 *
 * `log` is optional so the caller decides where the output goes (Fastify's logger when
 * this runs inside the server, plain stdout from the standalone script). EVERY pass is
 * reported, including the empty ones: an indexer that only speaks when it finds
 * something is indistinguishable from one that has silently died, and a stalled cursor
 * is what makes `/actions/prepare` 409 with STALE_INDEX.
 */
export function startIndexer(
  intervalMs = 10_000,
  opts: { log?: (msg: string) => void } = {},
): () => void {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return; // never overlap passes; the cursor is not reentrant
    running = true;
    try {
      const results = await runIndexerOnce({ onProgress: opts.log });
      if (opts.log) {
        const total = results.reduce((n, r) => n + r.logs, 0);
        opts.log(
          `[indexer] head ${results[0]?.toBlock ?? "?"} — ${total} new log(s)` +
            (total ? ` (${results.map((r) => `${r.name}:${r.logs}`).join(" ")})` : ""),
        );
      }
    } catch (err) {
      console.error("[indexer]", (err as Error).message);
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
