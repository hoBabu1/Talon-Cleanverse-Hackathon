import type { AbiEvent, Address, Log } from "viem";
import { publicClient } from "./chain.js";

/// Monad caps `eth_getLogs` at a 100-BLOCK RANGE. Confirmed live: a 1000-block
/// request returns `-32614 "eth_getLogs is limited to a 100 range"`. This is the
/// single most load-bearing constraint in the indexer:
///
///   - A naive backfill from the deploy block throws on its very first call.
///   - `watchContractEvent` breaks whenever it falls more than 100 blocks behind,
///     which a ~40-second restart is enough to cause.
///
/// So every log read in this codebase goes through this function. Nothing else
/// should call `getLogs` directly.
///
/// The range is INCLUSIVE on both ends, which is why the step is 99 rather than
/// 100: `[from, from+99]` spans exactly 100 blocks. Using 100 here would request
/// 101 and fail — an off-by-one that only shows up against the real RPC.
const MAX_RANGE = 99n;

export type PaginatedLogsOptions<TAbiEvent extends AbiEvent> = {
  address: Address | Address[];
  event: TAbiEvent;
  fromBlock: bigint;
  toBlock: bigint;
  /// Called after each page commits, so a caller can persist a cursor and make
  /// progress durable even if a later page fails. Receives the last block that
  /// is now fully scanned.
  onPage?: (lastBlockScanned: bigint, pageLogs: Log[]) => Promise<void> | void;
};

export async function paginatedGetLogs<TAbiEvent extends AbiEvent>(
  opts: PaginatedLogsOptions<TAbiEvent>,
): Promise<Log[]> {
  const { event, ...rest } = opts;
  return paginatedGetLogsForEvents({ ...rest, events: [event] });
}

export type PaginatedMultiLogsOptions = {
  address: Address | Address[];
  /// Several event ABIs matched in ONE request per page. The indexer needs this:
  /// the vault emits Deposited and Released, the manager emits five events, and
  /// each of them must advance the same cursor. Scanning per-event would mean
  /// either several cursors per contract or several passes over the same range.
  events: AbiEvent[];
  fromBlock: bigint;
  toBlock: bigint;
  onPage?: (lastBlockScanned: bigint, pageLogs: Log[]) => Promise<void> | void;
};

/// The single paging loop. `paginatedGetLogs` is a thin wrapper over it so there is
/// exactly one implementation of the 99-block stepping to get wrong.
export async function paginatedGetLogsForEvents(
  opts: PaginatedMultiLogsOptions,
): Promise<Log[]> {
  const { address, events, fromBlock, toBlock, onPage } = opts;

  // An empty or inverted range is not an error — it just means "already caught
  // up". Callers poll with fromBlock = cursor + 1, which legitimately exceeds
  // toBlock whenever no new block has been produced.
  if (fromBlock > toBlock) return [];

  const all: Log[] = [];

  for (let start = fromBlock; start <= toBlock; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE > toBlock ? toBlock : start + MAX_RANGE;

    const pageLogs = await publicClient.getLogs({
      address,
      events,
      fromBlock: start,
      toBlock: end,
    });

    all.push(...pageLogs);

    // onPage runs AFTER the page's logs are in hand and is where the caller makes
    // progress durable. If it throws, the cursor is not advanced and the same page
    // is rescanned on restart — which is safe precisely because every write keyed
    // on (tx_hash, log_index) is idempotent.
    if (onPage) await onPage(end, pageLogs);
  }

  return all;
}

/// Convenience for the common "catch up from a persisted cursor to chain head"
/// shape. Returns the head it scanned to, so the caller can store it.
export async function getLogsSinceCursor<TAbiEvent extends AbiEvent>(
  opts: Omit<PaginatedLogsOptions<TAbiEvent>, "fromBlock" | "toBlock"> & {
    cursorBlock: bigint;
  },
): Promise<{ logs: Log[]; headBlock: bigint }> {
  const headBlock = await publicClient.getBlockNumber();
  const logs = await paginatedGetLogs({
    ...opts,
    fromBlock: opts.cursorBlock + 1n,
    toBlock: headBlock,
  });
  return { logs, headBlock };
}
