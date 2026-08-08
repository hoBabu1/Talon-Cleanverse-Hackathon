// Shared revert-decoding helper for viem errors — extracted after being written correctly
// once (in the Phase 0 spike script's `describeRevert`) and then re-derived slightly
// differently, and broken, in the Phase 4 live-smoke script. Both scripts now import THIS
// file instead of re-deriving the logic a third time. See /learning.md, Phase 4 entry.
//
// The bug this fixes: viem nests the raw revert bytes on the ContractFunctionRevertedError
// link of the error's `.cause` chain (`.raw`, or sometimes `.data`), NOT at the top level and
// NOT under `.cause.data` directly — a naive single-level unwrap silently finds nothing and
// misclassifies every real revert as "unknown."
//
// Known selectors (empirically confirmed against the real Cleanverse A-Token on Monad testnet
// — see /learning.md Phase 0 spike and Phase 4 live-smoke entries). aUSDC is not verified on
// Sourcify (checked 2026-07-31, chain 10143: no match) and the Monad block explorer is
// Cloudflare-gated and couldn't be checked directly — so this list is exhaustive only of what
// we've EMPIRICALLY OBSERVED, not necessarily exhaustive of everything the token can revert
// with. Anything else falls through to the caller's own "unknown reason" handling.
export const APASS_NOT_ACTIVE_SELECTOR = "0x322fde89"; // APassNotActive(address) — frozen
export const APASS_EXPIRED_SELECTOR = "0xaecc0dbe"; // APassExpired(address) — expired

/**
 * NoAPass(address) — wallet has no A-Pass at all. Third eligibility failure mode,
 * distinct from frozen and expired. Confirmed live 2026-07-31 on both TLNB `mint`
 * and aUSDC `transferFrom` (the real executePayoutRun path). The deployed CAM is
 * frozen and tags this REASON_UNKNOWN_REVERT; the entitlement is still preserved,
 * and the raw bytes in HolderEscrowed let the meaning be recovered off-chain.
 */
export const NO_APASS_SELECTOR = "0xa6725971";

/**
 * Decodes a viem error (from simulateContract/writeContract/etc.) into
 * { selector, offender, raw, shortMessage }. `offender` is populated only when the revert
 * data is at least 4 (selector) + 32 (address, left-padded) = 36 bytes — the exact shape
 * confirmed for both APassNotActive(address) and APassExpired(address). Never throws.
 */
export function decodeViemRevertError(err) {
  let raw = null;
  let e = err;
  for (let i = 0; i < 8 && e; i++, e = e.cause) {
    if (typeof e.raw === "string") {
      raw = e.raw;
      break;
    }
    if (typeof e.data === "string") {
      raw = e.data;
      break;
    }
  }
  const selector = typeof raw === "string" && raw.length >= 10 ? raw.slice(0, 10) : null;
  const offender = typeof raw === "string" && raw.length >= 74 ? `0x${raw.slice(-40)}` : null;
  return { shortMessage: err?.shortMessage ?? err?.message, selector, offender, raw };
}

/**
 * Classifies a decoded selector against the known A-Pass eligibility selectors.
 * Returns "frozen" | "expired" | "other".
 */
export function classifyApassSelector(selector) {
  if (selector === APASS_NOT_ACTIVE_SELECTOR) return "frozen";
  if (selector === APASS_EXPIRED_SELECTOR) return "expired";
  if (selector === NO_APASS_SELECTOR) return "no_apass";
  return "other";
}
