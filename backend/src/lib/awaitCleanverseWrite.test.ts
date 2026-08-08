// Run with: npx tsx src/lib/awaitCleanverseWrite.test.ts
//
// Deliberately network-free and deterministic: the fakes below are scripted poll
// sequences, so each test pins one exact behaviour of the waiting rule. This helper is
// the single place the "API 200 != on-chain truth" race is handled, and the two silent
// bugs this project has already had both came from re-deriving this logic — so the
// properties that matter are asserted rather than assumed.
import assert from "node:assert/strict";
import {
  awaitCleanverseWrite,
  CleanverseWriteTimeoutError,
  formatWriteProgress,
  type PollState,
  type WriteProgress,
} from "./awaitCleanverseWrite.js";

type State = "active" | "frozen";

/** Returns each scripted state in turn, repeating the last one forever. */
function scripted(states: PollState<State>[]) {
  let i = 0;
  return async (): Promise<PollState<State>> => states[Math.min(i++, states.length - 1)];
}

let passed = 0;
function ok(name: string) {
  console.log(`  ok  ${name}`);
  passed++;
}

// 1. The happy path: the wanted state ends the wait.
{
  const r = await awaitCleanverseWrite<State>({
    label: "freeze",
    want: "frozen",
    check: scripted(["frozen"]),
    pollMs: 1,
  });
  assert.equal(r.state, "frozen");
  assert.equal(r.attempts, 1);
  ok("confirms immediately when the first poll already shows the wanted state");
}

// 2. It waits through the race — the whole reason this exists. A freeze that has been
//    accepted by the API but not yet landed reads "active" for a while first.
{
  const r = await awaitCleanverseWrite<State>({
    label: "freeze",
    want: "frozen",
    check: scripted(["active", "active", "frozen"]),
    pollMs: 1,
  });
  assert.equal(r.state, "frozen");
  assert.equal(r.attempts, 3);
  ok("keeps polling through a stale pre-write state and confirms on the real transition");
}

// 3. THE CRITICAL PROPERTY. "inconclusive" must never satisfy the wait, no matter how
//    long it persists. A boolean check would collapse "I could not tell" into "no" and
//    confirm a freeze that never landed.
{
  await assert.rejects(
    () =>
      awaitCleanverseWrite<State>({
        label: "freeze",
        want: "frozen",
        check: scripted(["inconclusive"]),
        timeoutMs: 30,
        pollMs: 1,
      }),
    (err: unknown) => {
      assert.ok(err instanceof CleanverseWriteTimeoutError);
      assert.equal(err.lastState, "inconclusive");
      assert.equal(err.want, "frozen");
      return true;
    },
  );
  ok("inconclusive NEVER satisfies the wait — it times out rather than confirming");
}

// 4. A different conclusive state is not a confirmation either. Waiting for "frozen" and
//    seeing "active" forever must time out, not resolve.
{
  await assert.rejects(
    () =>
      awaitCleanverseWrite<State>({
        label: "freeze",
        want: "frozen",
        check: scripted(["active"]),
        timeoutMs: 30,
        pollMs: 1,
      }),
    (err: unknown) => {
      assert.ok(err instanceof CleanverseWriteTimeoutError);
      assert.equal(err.lastState, "active");
      return true;
    },
  );
  ok("a different conclusive state does not satisfy the wait");
}

// 5. A throwing check is inconclusive, not a negative result. An RPC blip must never be
//    recorded as "confirmed not frozen".
{
  let calls = 0;
  const r = await awaitCleanverseWrite<State>({
    label: "freeze",
    want: "frozen",
    check: async () => {
      calls++;
      if (calls < 3) throw new Error("RPC blip");
      return "frozen";
    },
    pollMs: 1,
  });
  assert.equal(r.state, "frozen");
  assert.equal(r.attempts, 3);
  ok("a throwing check is treated as inconclusive and retried, not as a negative");
}

// 6. Progress is reported on every poll, and `confirmed` is true on exactly one of them.
//    The wait is meant to be shown, so this is a real behaviour, not a debug nicety.
{
  const seen: WriteProgress<State>[] = [];
  await awaitCleanverseWrite<State>({
    label: "unfreeze RETAIL",
    want: "active",
    check: scripted(["frozen", "frozen", "active"]),
    pollMs: 1,
    onProgress: (p) => seen.push(p),
  });
  assert.equal(seen.length, 3);
  assert.deepEqual(
    seen.map((p) => p.confirmed),
    [false, false, true],
  );
  assert.deepEqual(
    seen.map((p) => p.attempt),
    [1, 2, 3],
  );
  assert.match(formatWriteProgress(seen[0]), /confirming on-chain/);
  assert.match(formatWriteProgress(seen[2]), /confirmed on-chain/);
  ok("reports progress on every poll, with confirmed=true on exactly the final one");
}

// 7. The deadline is honoured rather than overshot by one full poll interval.
{
  const started = Date.now();
  await assert.rejects(() =>
    awaitCleanverseWrite<State>({
      label: "freeze",
      want: "frozen",
      check: scripted(["active"]),
      timeoutMs: 50,
      pollMs: 10_000,
    }),
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_000, `expected to give up near the deadline, took ${elapsed}ms`);
  ok("does not sleep past the deadline when pollMs exceeds the remaining time");
}

console.log(`\n${passed} passed`);
