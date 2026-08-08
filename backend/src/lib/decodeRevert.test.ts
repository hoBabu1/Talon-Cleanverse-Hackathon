// Minimal self-test, no framework dependency — mirrors contracts/scripts/lib/decodeRevert.test.mjs
// exactly (same test vectors) to prove the TS port stayed logic-identical. Run with: npx tsx src/lib/decodeRevert.test.ts
import assert from "node:assert/strict";
import { decodeViemRevertError, classifyApassSelector, describeApassRevertClass, APASS_NOT_ACTIVE_SELECTOR, APASS_EXPIRED_SELECTOR, NO_APASS_SELECTOR } from "./decodeRevert.js";

function fakeViemError(rawHex: string, depth = 1): unknown {
  let err: Record<string, unknown> = { raw: rawHex };
  for (let i = 0; i < depth; i++) err = { cause: err, shortMessage: "reverted" };
  return err;
}

{
  const addr = "71b0c66ec7076bb27cd4280b0ad0b1b88f7873c6";
  const raw = APASS_NOT_ACTIVE_SELECTOR + "0".repeat(24) + addr;
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 1));
  assert.equal(selector, APASS_NOT_ACTIVE_SELECTOR);
  assert.equal(offender, "0x" + addr);
  assert.equal(classifyApassSelector(selector), "frozen");
}

{
  const addr = "924c33f763860e433fdc02a0158d2916e66b7410";
  const raw = APASS_EXPIRED_SELECTOR + "0".repeat(24) + addr;
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 3));
  assert.equal(selector, APASS_EXPIRED_SELECTOR);
  assert.equal(offender, "0x" + addr);
  assert.equal(classifyApassSelector(selector), "expired");
}

{
  const result = decodeViemRevertError({ cause: { cause: {} }, message: "generic failure" });
  assert.equal(result.selector, null);
  assert.equal(result.offender, null);
}

{
  const raw = APASS_NOT_ACTIVE_SELECTOR;
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 2));
  assert.equal(selector, APASS_NOT_ACTIVE_SELECTOR);
  assert.equal(offender, null);
}

{
  assert.equal(classifyApassSelector("0xdeadbeef"), "other");
}

// NoAPass(address) — the third eligibility failure mode, pinned to the EXACT bytes
// the live Monad RPC returned on 2026-07-31 for aUSDC.transferFrom into a wallet
// with no A-Pass (the real executePayoutRun path), not a hand-constructed vector.
{
  const raw =
    "0xa672597100000000000000000000000000000000000000000000000000000000deadbeef";
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 2));
  assert.equal(selector, NO_APASS_SELECTOR);
  assert.equal(offender, "0x00000000000000000000000000000000deadbeef");
  assert.equal(classifyApassSelector(selector), "no_apass");
  assert.match(describeApassRevertClass("no_apass"), /preserved/);
}

// The three A-Pass failure modes must stay mutually distinct. Collapsing any pair
// would falsify this project's central claim that it does not conflate
// lapsed-with-sanctioned, using its own audit trail as the evidence.
{
  const classes = [
    classifyApassSelector(APASS_NOT_ACTIVE_SELECTOR),
    classifyApassSelector(APASS_EXPIRED_SELECTOR),
    classifyApassSelector(NO_APASS_SELECTOR),
    classifyApassSelector("0xdeadbeef"),
  ];
  assert.equal(new Set(classes).size, 4, "A-Pass failure classes must not collapse");
}

console.log("decodeRevert.test.ts: all assertions passed.");
