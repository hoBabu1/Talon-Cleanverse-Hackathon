// Minimal self-test for decodeRevert.mjs — no test framework dependency (this is a plain Node
// script tree, not the Foundry test suite). Run with: node decodeRevert.test.mjs
import assert from "node:assert/strict";
import { decodeViemRevertError, classifyApassSelector, APASS_NOT_ACTIVE_SELECTOR, APASS_EXPIRED_SELECTOR } from "./decodeRevert.mjs";

// Mirrors the real shape viem produces: raw bytes live on a nested `.cause`, not top-level.
function fakeViemError(rawHex, depth = 1) {
  let err = { raw: rawHex };
  for (let i = 0; i < depth; i++) err = { cause: err, shortMessage: "reverted" };
  return err;
}

// 1. Real APassNotActive(address) shape, nested one level deep (matches observed viem errors).
{
  const addr = "71b0c66ec7076bb27cd4280b0ad0b1b88f7873c6";
  const raw = APASS_NOT_ACTIVE_SELECTOR + "0".repeat(24) + addr;
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 1));
  assert.equal(selector, APASS_NOT_ACTIVE_SELECTOR);
  assert.equal(offender, "0x" + addr);
  assert.equal(classifyApassSelector(selector), "frozen");
}

// 2. APassExpired(address), nested three levels deep (the actual depth seen live in Phase 4).
{
  const addr = "924c33f763860e433fdc02a0158d2916e66b7410";
  const raw = APASS_EXPIRED_SELECTOR + "0".repeat(24) + addr;
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 3));
  assert.equal(selector, APASS_EXPIRED_SELECTOR);
  assert.equal(offender, "0x" + addr);
  assert.equal(classifyApassSelector(selector), "expired");
}

// 3. No raw data anywhere in the chain — must not throw, must return nulls.
{
  const result = decodeViemRevertError({ cause: { cause: {} }, message: "generic failure" });
  assert.equal(result.selector, null);
  assert.equal(result.offender, null);
}

// 4. Selector-only (4 bytes), too short for an offender.
{
  const raw = APASS_NOT_ACTIVE_SELECTOR;
  const { selector, offender } = decodeViemRevertError(fakeViemError(raw, 2));
  assert.equal(selector, APASS_NOT_ACTIVE_SELECTOR);
  assert.equal(offender, null);
}

// 5. Unknown selector classifies as "other".
{
  assert.equal(classifyApassSelector("0xdeadbeef"), "other");
}

console.log("decodeRevert.test.mjs: all assertions passed.");
