# Talon — one-page summary

**On-chain transfer agent for Cleanverse-verified real-world assets.**
Cleanverse Build: Trusted Assets Hackathon · RWA track · solo build.

- **Live app** — <https://talon-cleanverse-hackathon.vercel.app>
- **Demo video** — <https://youtu.be/CT_b-7mUf2U>
- **Code** — <https://github.com/hoBabu1/Talon-Cleanverse-Hackathon>
- **Print-ready PDF** — [`docs/Talon-One-Page-Summary.pdf`](docs/Talon-One-Page-Summary.pdf)

## The problem — eligibility drift

Every RWA project stops at issuance. Talon runs what happens **after** — coupons, dividends, redemptions — and fixes the one failure only *verified* assets have.

A holder is verified on the **record date** and earns a coupon. By the **pay date**, days later, their Cleanverse A-Pass has frozen or expired — through no fault of their own. Now every payout is a trap:

- ❌ **Pay them anyway** → a compliance violation (Cleanverse's own A-Token reverts on-chain anyway).
- ❌ **Withhold the coupon** → theft; they earned it while fully verified.

**This exists only because Cleanverse identity is revocable and expiring.** On a plain ERC-20 there is nothing to drift — Talon could not be built on anything else.

## The solution — pay where compliant, escrow where not, never forfeit

- At pay date, Talon attempts the **real transfer**, holder by holder.
- **Still compliant →** paid directly, with a Travel Rule report for that exact tx.
- **Reverts →** escrowed **per-beneficiary**, tagged with the chain's own reason — **never forfeited** (there is deliberately no admin-confiscation function).
- **Release = a retry of that same real transfer** — if it succeeds, the holder is genuinely eligible again.

**We never re-implement compliance.** The A-Token's own on-chain revert *is* our compliance check. Eligibility stays Cleanverse's verdict; the chain is the source of truth, and we only react to it.

## CVI · CVA integration — six, all live, none mocked

| Point | How Talon uses it |
|---|---|
| **A-Pass · CVI** | the revocable, expiring credential the whole product reacts to |
| **A-Token · CVA** | **its on-chain revert IS our compliance check** |
| `generate_apass` | the vault holds **its own A-Pass** so it can custody A-Tokens |
| `query_apass` | poll holder eligibility — Cleanverse ships no webhook |
| `update_status` | freeze / reinstate a holder **live from the dashboard** |
| `download_travel_rule` | per-payout regulatory report, stored as bytes |

**Depth, not surface:** frozen (`0x322fde89`), expired (`0xaecc0dbe`) and no-pass are three **distinct on-chain reasons**, never conflated — because lapsed ≠ sanctioned. The revert data even names the offending party, so one holder's failure never mis-blames another.

## Deployed — Monad testnet, chain ID `10143`

Contracts **deployed and frozen**; both the coupon currency and the asset are real A-Tokens.

- **EscrowVault** — `0xb634379B2afdF12830eaef694cFeaE80fB0dFFB7`
- **CorporateActionManager** — `0xF897874bAe28443a60ef92741f7df504F90386b6`
- aUSDC (coupon currency) · TLNB "Talon Bond 2026" (the asset)

## Build quality & scale

- **90 tests green** — unit, fuzz & cross-contract invariants (256 × 64), proving `sum(ledger) ≤ balanceOf(vault)` through the real manager→vault wiring.
- **Proven with money that moves** — a live smoke test on real aUSDC: one holder paid directly; a second frozen → escrowed → reinstated → released → claimed.
- **One vault, every asset** — a single vault custodies any number of A-Tokens; resumable, paginated batched payouts; no per-issuance redeploy.

---

Built solo by [@thedhanyosmi](https://x.com/thedhanyosmi). Mobile-first dashboard: cap table · actions · escrow · identity · audit. **No eligible holder forfeits. No ineligible holder gets paid.**
