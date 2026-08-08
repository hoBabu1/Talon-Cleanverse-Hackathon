/**
 * Revert-decoding helper for viem errors — TypeScript port of
 * contracts/scripts/lib/decodeRevert.mjs. The two runtimes (this backend's TS/Node setup and
 * the contracts/ plain-Node scripts) aren't a shared package, so this is a deliberate,
 * logic-identical port rather than a literal shared file — keep them in sync if either
 * changes. Extracted after the same decoding logic was written correctly once, then rewritten
 * slightly differently and silently broken once, in two different scripts this session (see
 * /learning.md, Phase 4 entry). The frontend's failure-attribution UI (holder vs issuer vs
 * vault) depends on this being correct — do not re-derive it a third time.
 *
 * Known selectors are empirical, not exhaustive — aUSDC is unverified on Sourcify (checked
 * 2026-07-31, chain 10143) and the Monad explorer is Cloudflare-gated, so this list covers
 * only what's been directly observed on-chain.
 */

export const APASS_NOT_ACTIVE_SELECTOR = "0x322fde89"; // APassNotActive(address) — frozen
export const APASS_EXPIRED_SELECTOR = "0xaecc0dbe"; // APassExpired(address) — expired

/**
 * NoAPass(address) — the wallet has no A-Pass at all. A THIRD eligibility failure
 * mode, distinct from frozen and from expired, confirmed live on 2026-07-31 against
 * BOTH tokens: TLNB `mint` and, critically, aUSDC `transferFrom` on the exact path
 * `executePayoutRun` takes.
 *
 * The deployed CorporateActionManager predates this discovery and is frozen, so it
 * classifies this as REASON_UNKNOWN_REVERT (0x19957115) rather than giving it a
 * dedicated tag. That is a display gap, NOT a safety gap: the escrow leg still runs
 * and the holder's entitlement is still preserved — which is exactly what
 * UNKNOWN_REVERT was designed to guarantee for failures we hadn't catalogued.
 *
 * The CAM emits the raw revert bytes in the HolderEscrowed event, so the backend can
 * recover the real meaning off-chain and render "No A-Pass" instead of unexplained
 * hex. The UI must still show the on-chain tag as UNKNOWN_REVERT — the chain's own
 * record is authoritative and is never overwritten by our better-informed off-chain
 * read; the decoded meaning is presented alongside it, not in place of it.
 */
export const NO_APASS_SELECTOR = "0xa6725971";

export interface DecodedRevert {
  shortMessage?: string;
  selector: string | null;
  offender: string | null;
  raw: string | null;
}

/** Minimal shape covering however deep viem nests the raw revert bytes in `.cause`. */
interface ViemLikeError {
  raw?: unknown;
  data?: unknown;
  shortMessage?: unknown;
  message?: unknown;
  cause?: ViemLikeError;
}

export function decodeViemRevertError(err: unknown): DecodedRevert {
  let raw: string | null = null;
  let e = err as ViemLikeError | undefined;
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
  const selector = raw !== null && raw.length >= 10 ? raw.slice(0, 10) : null;
  const offender = raw !== null && raw.length >= 74 ? `0x${raw.slice(-40)}` : null;
  const top = err as ViemLikeError | undefined;
  const shortMessage =
    (typeof top?.shortMessage === "string" ? top.shortMessage : undefined) ??
    (typeof top?.message === "string" ? top.message : undefined);
  return { shortMessage, selector, offender, raw };
}

export type ApassRevertClass = "frozen" | "expired" | "no_apass" | "other";

export function classifyApassSelector(selector: string | null): ApassRevertClass {
  if (selector === APASS_NOT_ACTIVE_SELECTOR) return "frozen";
  if (selector === APASS_EXPIRED_SELECTOR) return "expired";
  if (selector === NO_APASS_SELECTOR) return "no_apass";
  return "other";
}

/**
 * Plain-English label for an escrow row, derived from the raw revert bytes the CAM
 * recorded. Deliberately phrased so no variant reads as fault or forfeiture: an
 * expired credential is an administrative lapse, not a sanction, and none of these
 * states cost the holder their entitlement.
 */
export function describeApassRevertClass(cls: ApassRevertClass): string {
  switch (cls) {
    case "frozen":
      return "Credential frozen. Entitlement preserved.";
    case "expired":
      return "Credential expired. Entitlement preserved.";
    case "no_apass":
      return "No A-Pass on this wallet. Entitlement preserved.";
    case "other":
      return "Unclassified transfer failure — funds preserved, not forfeited.";
  }
}
