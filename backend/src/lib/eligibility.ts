/**
 * On-chain eligibility truth for a wallet, and the confirmation gates that sit on top of it.
 *
 * Every function here answers the same underlying question by ASKING THE TOKEN, not by
 * asking Cleanverse: "if we tried to move value to this wallet right now, what would
 * happen?" That distinction is the whole point. Cleanverse's API reports what it has been
 * told; the A-Token reports what it will actually enforce. The API is authoritative about
 * *why* a wallet is ineligible, but only the chain is authoritative about *whether* it is.
 *
 * Every wait in this file goes through the single `awaitCleanverseWrite` helper — see the
 * header there for why there are no per-endpoint variants.
 */
import { parseAbi, type Address } from "viem";
import { publicClient, CONTRACTS, lc } from "./chain.js";
import { decodeViemRevertError, classifyApassSelector } from "./decodeRevert.js";
import { awaitCleanverseWrite, type PollState, type WriteProgress } from "./awaitCleanverseWrite.js";

const ATOKEN_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

const CAM_OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

/**
 * The probe's sender. A-Tokens check the SENDER's eligibility too, so a probe sent from an
 * ineligible account reverts naming the sender and tells us nothing about the wallet we
 * actually care about. The issuer is used because it is the account that really does the
 * paying, so its eligibility is a precondition of the demo regardless.
 */
let issuerCache: Address | undefined;
export async function issuerAddress(): Promise<Address> {
  issuerCache ??= await publicClient.readContract({
    address: CONTRACTS.cam,
    abi: CAM_OWNER_ABI,
    functionName: "owner",
  });
  return issuerCache;
}

/**
 * The four ways a wallet can be ineligible, plus "active". Deliberately NOT a boolean.
 *
 * `no_apass` is a genuinely distinct third failure mode from frozen and expired, confirmed
 * live against both TLNB and aUSDC. The deployed CorporateActionManager predates that
 * discovery and tags it REASON_UNKNOWN_REVERT on-chain; that is a display gap, not a safety
 * gap, and it is never papered over here — see decodeRevert.ts.
 */
export type EligibilityState = "active" | "frozen" | "expired" | "no_apass";

/**
 * Simulate a 1-unit transfer to `holder` and classify the outcome.
 *
 * Returns "inconclusive" — never a guess — when the revert is not an eligibility revert, or
 * when it names somebody other than the wallet being probed. Both cases genuinely tell us
 * nothing about `holder`: a drained issuer balance and a frozen ISSUER both revert, and
 * reading either as "the holder is fine" or "the holder is frozen" would be a fabrication.
 */
export async function probeEligibility(
  holder: string,
  token: Address = CONTRACTS.aUSDC,
): Promise<PollState<EligibilityState>> {
  const from = await issuerAddress();
  try {
    await publicClient.simulateContract({
      account: from,
      address: token,
      abi: ATOKEN_ABI,
      functionName: "transfer",
      args: [holder as Address, 1n],
    });
    return "active";
  } catch (err) {
    const { selector, offender } = decodeViemRevertError(err);
    const cls = classifyApassSelector(selector);
    if (cls === "other") return "inconclusive";

    // The revert data names the offending party. If it names the issuer (or anyone else),
    // this poll says nothing about `holder`.
    if (offender !== null && lc(offender) !== lc(holder)) return "inconclusive";
    return cls;
  }
}

export type ProgressSink = (p: WriteProgress<string>) => void;

/**
 * Confirm a freeze or unfreeze actually landed on-chain.
 *
 * `update_status` returning 200 is not proof. Only an eligibility revert naming this holder
 * confirms frozen, and only a clean simulation confirms active.
 */
export async function awaitFreezeState(
  holder: string,
  expectFrozen: boolean,
  opts: { token?: Address; timeoutMs?: number; onProgress?: ProgressSink } = {},
): Promise<void> {
  await awaitCleanverseWrite<EligibilityState>({
    label: `${expectFrozen ? "freeze" : "unfreeze"} ${holder}`,
    want: expectFrozen ? "frozen" : "active",
    check: () => probeEligibility(holder, opts.token),
    timeoutMs: opts.timeoutMs,
    onProgress: opts.onProgress,
  });
}

/**
 * Confirm a freshly generated A-Pass is live on-chain and the wallet can actually receive.
 *
 * generate_apass returns 200 well before this is true — observed returning code 2 ("no
 * A-Pass") from verify_apass for several seconds afterwards. Gating a mint on this means a
 * mint can never revert with NoAPass.
 */
export async function awaitApassUsable(
  holder: string,
  opts: { token?: Address; timeoutMs?: number; onProgress?: ProgressSink } = {},
): Promise<void> {
  await awaitCleanverseWrite<EligibilityState>({
    label: `A-Pass for ${holder}`,
    want: "active",
    check: () => probeEligibility(holder, opts.token),
    timeoutMs: opts.timeoutMs,
    onProgress: opts.onProgress,
  });
}

/**
 * Confirm minted/transferred value is actually credited.
 *
 * A successful receipt is normally sufficient for a plain ERC-20, but A-Token issuance can
 * route through the registrar, so balance is the fact and the receipt is only evidence.
 */
export async function awaitBalanceAtLeast(
  holder: string,
  minimum: bigint,
  opts: { token?: Address; timeoutMs?: number; onProgress?: ProgressSink } = {},
): Promise<void> {
  const token = opts.token ?? CONTRACTS.aUSDC;
  await awaitCleanverseWrite<"credited">({
    label: `balance >= ${minimum} for ${holder}`,
    want: "credited",
    timeoutMs: opts.timeoutMs,
    onProgress: opts.onProgress,
    check: async (): Promise<PollState<"credited">> => {
      const bal = await publicClient.readContract({
        address: token,
        abi: ATOKEN_ABI,
        functionName: "balanceOf",
        args: [holder as Address],
      });
      return bal >= minimum ? "credited" : "inconclusive";
    },
  });
}
