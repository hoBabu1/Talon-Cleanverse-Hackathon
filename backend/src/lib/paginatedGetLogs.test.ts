// Live test against the REAL Monad RPC. Run with: npx tsx src/lib/paginatedGetLogs.test.ts
//
// This tests the one constraint the whole indexer is built around, so it
// deliberately hits the real network rather than a mock: a mock of eth_getLogs
// would just encode our assumption about the cap, which is exactly the thing
// worth verifying.
import assert from "node:assert/strict";
import { parseAbiItem } from "viem";
import { publicClient, CONTRACTS } from "./chain.js";
import { paginatedGetLogs } from "./paginatedGetLogs.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const head = await publicClient.getBlockNumber();
console.log("chain head:", head);

// 1. The cap is real. If this ever STOPS throwing, the pagination below is no
//    longer load-bearing and this test should be revisited rather than deleted.
{
  let threw = false;
  try {
    await publicClient.getLogs({
      address: CONTRACTS.aUSDC,
      event: transferEvent,
      fromBlock: head - 1000n,
      toBlock: head,
    });
  } catch (err) {
    threw = true;
    const msg = String((err as Error).message ?? err);
    assert.ok(
      /100 range|-32614/.test(msg),
      `expected the 100-range cap error, got: ${msg}`,
    );
    console.log("ok  raw 1000-block getLogs rejected by the RPC, as expected");
  }
  assert.ok(threw, "a 1000-block getLogs unexpectedly succeeded");
}

// 2. The same range succeeds through the paginator.
{
  const logs = await paginatedGetLogs({
    address: CONTRACTS.aUSDC,
    event: transferEvent,
    fromBlock: head - 1000n,
    toBlock: head,
  });
  console.log(`ok  paginated 1001-block scan returned ${logs.length} logs`);
}

// 3. Boundary: exactly 100 blocks is one page and must not throw. This is the
//    off-by-one that a step of 100 (rather than 99) would introduce, and it is
//    invisible except against the real RPC.
{
  const logs = await paginatedGetLogs({
    address: CONTRACTS.aUSDC,
    event: transferEvent,
    fromBlock: head - 99n,
    toBlock: head,
  });
  console.log(`ok  exact 100-block boundary page returned ${logs.length} logs`);
}

// 4. Pages cover the range contiguously, with no gap and no overlap. A gap here
//    means silently missing holders in the cap table.
{
  const from = head - 250n;
  const seen: Array<[bigint, bigint]> = [];
  let prevEnd: bigint | null = null;

  await paginatedGetLogs({
    address: CONTRACTS.aUSDC,
    event: transferEvent,
    fromBlock: from,
    toBlock: head,
    onPage: (lastBlockScanned) => {
      const start = prevEnd === null ? from : prevEnd + 1n;
      seen.push([start, lastBlockScanned]);
      assert.ok(
        lastBlockScanned - start + 1n <= 100n,
        `page ${start}..${lastBlockScanned} exceeds the 100-block cap`,
      );
      prevEnd = lastBlockScanned;
    },
  });

  assert.equal(seen[0][0], from, "first page must start at fromBlock");
  assert.equal(prevEnd, head, "last page must end exactly at toBlock");
  console.log(`ok  ${seen.length} contiguous pages covered ${from}..${head}`);
}

// 5. An already-caught-up cursor is a no-op, not an error. The poller calls with
//    fromBlock = cursor + 1 every tick, which legitimately exceeds head.
{
  const logs = await paginatedGetLogs({
    address: CONTRACTS.aUSDC,
    event: transferEvent,
    fromBlock: head + 1n,
    toBlock: head,
  });
  assert.deepEqual(logs, []);
  console.log("ok  inverted/empty range returns [] instead of throwing");
}

// 6. It actually FINDS a known event, spanning multiple pages. Checks 2-4 above
//    pass trivially against a quiet block range, so on their own they prove
//    "no gaps" without proving "finds anything". This pins a real, permanent
//    on-chain event -- the closeAction(0) that retired the stale smoke-test
//    action -- at a known block, deliberately scanned via a 401-block (5-page)
//    window so the event sits inside a page rather than at a boundary.
{
  const actionClosed = parseAbiItem(
    "event ActionClosed(uint256 indexed actionId, uint32 paid, uint32 escrowed, uint256 unspent, bool coverageComplete)",
  );
  const logs = await paginatedGetLogs({
    address: CONTRACTS.cam,
    event: actionClosed,
    fromBlock: 49502600n,
    toBlock: 49503000n,
  });

  assert.equal(logs.length, 1, "expected exactly one ActionClosed in this window");
  const log = logs[0] as unknown as {
    blockNumber: bigint;
    args: { actionId: bigint; paid: number; escrowed: number; coverageComplete: boolean };
  };
  assert.equal(log.blockNumber, 49502743n);
  assert.equal(log.args.actionId, 0n);
  assert.equal(log.args.paid, 1);
  assert.equal(log.args.escrowed, 1);
  assert.equal(log.args.coverageComplete, true);
  console.log("ok  found + decoded the real ActionClosed(0) at block 49502743");
}

console.log("\npaginatedGetLogs: all checks passed against live Monad RPC");
