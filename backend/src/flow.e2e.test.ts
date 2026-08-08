/**
 * THE CROSS-LAYER FLOW TEST.  Run with: npm run test:flow
 *
 * Why this file exists, stated plainly because it is the only justification for a test this
 * expensive: the contracts have 90 passing Foundry tests, the backend has four passing live
 * suites, and every route returns 200 against real data. Every layer is verified in
 * isolation and every layer looks fine. The bug that motivated this file lived in NONE of
 * them — it lived in the seam. `/actions/prepare` wrote a mirror row claiming an action was
 * `Declared` before any declaring transaction existed; the actionId-clash gate then read
 * that row as proof the id was taken; `actionsCount()` never advanced because nothing was
 * ever declared; and so every subsequent prepare predicted the same id and hit the same
 * permanent 409. Contract tests cannot see it (no contract is involved). Backend unit tests
 * cannot see it (each write is individually correct). Only a test that drives the real
 * routes against the real chain and then asks "do these two now agree?" can.
 *
 * So the governing rule here is: AFTER EVERY STEP, ASSERT THE CHAIN AND THE MIRROR AGREE.
 * Not that the call returned 200 — a 200 is exactly what the original bug returned. Mirror
 * drift is this system's most dangerous failure precisely because every individual row
 * still looks right.
 *
 * Nothing is mocked. Real Monad testnet, real Cleanverse sandbox, real Supabase, real money
 * (raw aUSDC units). The Fastify app is built in-process from the same `buildApp()` that
 * serves production and driven with `inject()`, so the routes under test are the routes
 * that ship.
 *
 * ORDERING IS DELIBERATE: cheap deterministic assertions first, chain writes last, so a
 * broken system fails in seconds rather than after four minutes of gas.
 *
 * RE-RUNNABILITY: every run declares a FRESH action (id predicted from `actionsCount()`),
 * closes everything it declares, and leaves no `Prepared` rows behind. Two consecutive runs
 * must both pass — otherwise a session gets spent debugging the test instead of the system.
 * The run costs roughly 100 raw aUSDC units and ~0.5 MON; both budgets are printed at the
 * end, because the real limit on re-runnability is the issuer's testnet balance.
 */
import assert, { AssertionError } from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createWalletClient,
  http,
  parseAbi,
  decodeFunctionData,
  decodeEventLog,
  decodeErrorResult,
  encodeAbiParameters,
  keccak256,
  pad,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { buildApp } from "./app.js";
import { publicClient, monadTestnet, CONTRACTS, DEPLOY_BLOCKS, lc } from "./lib/chain.js";
import { requireSupabase } from "./lib/supabase.js";
import { runIndexerOnce, getCursor } from "./jobs/indexer.js";
import { runPollerOnce } from "./jobs/poller.js";
import { commitmentSeed, chainStep, buildBatches } from "./lib/entitlements.js";
import { probeEligibility, awaitFreezeState, issuerAddress } from "./lib/eligibility.js";
import { formatWriteProgress } from "./lib/awaitCleanverseWrite.js";
import {
  classifyApassSelector,
  APASS_NOT_ACTIVE_SELECTOR,
  APASS_EXPIRED_SELECTOR,
  NO_APASS_SELECTOR,
} from "./lib/decodeRevert.js";
import { cleanverse } from "./lib/cleanverse.js";
import { paginatedGetLogsForEvents } from "./lib/paginatedGetLogs.js";
import CAM_ABI from "./generated/CorporateActionManager.abi.json" with { type: "json" };
import VAULT_ABI from "./generated/EscrowVault.abi.json" with { type: "json" };
import ADDRESSES from "./generated/addresses.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Result accounting — the three lists this run has to produce
// ---------------------------------------------------------------------------

interface Failure {
  name: string;
  expected: unknown;
  actual: unknown;
  detail?: string;
}

const passed: string[] = [];
const failed: Failure[] = [];
const skipped: { name: string; why: string }[] = [];

function pass(name: string) {
  passed.push(name);
  console.log(`  ✓ ${name}`);
}

function fail(name: string, expected: unknown, actual: unknown, detail?: string) {
  failed.push({ name, expected, actual, detail });
  console.log(`  ✗ ${name}\n      expected: ${fmt(expected)}\n      actual:   ${fmt(actual)}`);
  if (detail) console.log(`      ${detail}`);
}

/**
 * An edge case that could NOT be exercised, recorded rather than quietly dropped.
 * This list is the most important output of the run: a silently skipped edge case is the
 * one that surfaces during the demo.
 */
function skip(name: string, why: string) {
  skipped.push({ name, why });
  console.log(`  ○ ${name}\n      ${why}`);
}

function fmt(v: unknown): string {
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
  } catch {
    return String(v);
  }
}

/**
 * Run one assertion block. A thrown AssertionError becomes a recorded failure with its
 * expected/actual intact; any other throw is recorded as an error. Returns whether it
 * passed, so a caller can decide whether the phases downstream are still meaningful.
 */
async function check(name: string, fn: () => Promise<void> | void): Promise<boolean> {
  try {
    await fn();
    pass(name);
    return true;
  } catch (err) {
    if (err instanceof AssertionError) {
      fail(name, err.expected, err.actual, err.message);
    } else {
      fail(name, "no exception", (err as Error).message ?? String(err));
    }
    return false;
  }
}

function phase(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 62 - title.length))}`);
}

// ---------------------------------------------------------------------------
// Wallets. The issuer key is read from disk and never printed.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function loadEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const spike = loadEnvFile(path.join(ROOT, "contracts/script/spike/.spike-wallets.env"));
const ISSUER_PK = (process.env.TALON_ISSUER_PRIVATE_KEY ?? spike.DEPLOYER_PRIVATE_KEY) as
  | Hex
  | undefined;
if (!ISSUER_PK) {
  console.error(
    "No issuer key. Set TALON_ISSUER_PRIVATE_KEY, or keep contracts/script/spike/.spike-wallets.env in place.",
  );
  process.exit(2);
}

const issuerAccount = privateKeyToAccount(ISSUER_PK);
const wallet = createWalletClient({
  account: issuerAccount,
  chain: monadTestnet,
  transport: http(monadTestnet.rpcUrls.default.http[0]),
});

/**
 * The holder frozen mid-flight. HOLDER2 from the Phase 0 spike: it is in the live cap
 * table, it holds TLNB, and it is the wallet whose A-Pass we control. Freezing a holder we
 * do not control is not an option, and freezing one with no entitlement would prove nothing.
 */
const DRIFT_HOLDER = lc(spike.HOLDER2_FREEZABLE_ADDRESS ?? "");

/** Definitely not a party to any payout transaction. Used for the audit refusal test. */
const NON_PARTICIPANT = "0x000000000000000000000000000000000000dEaD" as Address;

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function transferFrom(address,address,uint256) returns (bool)",
  "function totalSupply() view returns (uint256)",
]);

const SKIP_ISSUER_FREEZE = process.env.SKIP_ISSUER_FREEZE === "1";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const db = requireSupabase();
const app = await buildApp({ logger: false });

async function get(url: string) {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown>, raw: res.rawPayload };
}

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: "POST", url, payload: payload as object });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

interface OnChainAction {
  token: Address;
  asset: Address;
  recordBlock: bigint;
  totalAmount: bigint;
  remainingBudget: bigint;
  holderSetHash: Hex;
  runningHash: Hex;
  nextIndex: number;
  totalHolders: number;
  paidCount: number;
  escrowedCount: number;
  redirectAfter: bigint;
  status: number;
}

const CHAIN_STATUS: Record<number, string> = { 1: "Declared", 2: "Executing", 3: "Closed" };

async function getActionOnChain(id: number | bigint): Promise<OnChainAction> {
  return (await publicClient.readContract({
    address: CONTRACTS.cam,
    abi: CAM_ABI,
    functionName: "getAction",
    args: [BigInt(id)],
  })) as OnChainAction;
}

async function mirrorRow(id: number) {
  const { data } = await db.from("corporate_actions").select("*").eq("action_id", id).maybeSingle();
  return data as Record<string, unknown> | null;
}

/**
 * THE central assertion of this whole file.
 *
 * Every field the mirror claims to hold must equal what `getAction()` says, field by field.
 * A row that merely "looks plausible" is what the original bug produced, and it is what a
 * per-field comparison against chain truth makes impossible to ship.
 */
async function assertMirrorMatchesChain(id: number, label: string) {
  const chain = await getActionOnChain(id);
  const row = await mirrorRow(id);
  assert.ok(row, `${label}: no mirror row for action ${id}`);

  assert.equal(lc(row.payment_token as string), lc(chain.token), `${label}: payment_token`);
  assert.equal(lc(row.asset as string), lc(chain.asset), `${label}: asset`);
  assert.equal(BigInt(row.record_block as number), chain.recordBlock, `${label}: record_block`);
  assert.equal(BigInt(row.total_amount as string), chain.totalAmount, `${label}: total_amount`);
  assert.equal(row.holder_set_hash, chain.holderSetHash, `${label}: holder_set_hash`);
  assert.equal(row.running_hash, chain.runningHash, `${label}: running_hash`);
  assert.equal(row.next_index, chain.nextIndex, `${label}: next_index`);
  assert.equal(row.total_holders, chain.totalHolders, `${label}: total_holders`);
  assert.equal(row.paid_count, chain.paidCount, `${label}: paid_count`);
  assert.equal(row.escrowed_count, chain.escrowedCount, `${label}: escrowed_count`);
  assert.equal(row.status, CHAIN_STATUS[chain.status], `${label}: status`);
  assert.equal(
    row.coverage_complete,
    chain.nextIndex === chain.totalHolders && chain.runningHash === chain.holderSetHash,
    `${label}: coverage_complete`,
  );
}

/**
 * The vault's core invariant, read live from the chain: sum(ledger) <= balanceOf(vault).
 *
 * `<=` and not `==` on purpose — anyone can donate tokens to the vault, and that surplus is
 * recoverable only via the owner-only skim. Asserted after EVERY mutating step, because an
 * invariant checked once is a coincidence.
 */
async function assertVaultInvariant(label: string) {
  const token = CONTRACTS.aUSDC;
  const count = (await publicClient.readContract({
    address: CONTRACTS.vault,
    abi: VAULT_ABI,
    functionName: "beneficiaryCount",
    args: [token],
  })) as bigint;

  let sum = 0n;
  const PAGE = 100n;
  for (let start = 0n; start < count; start += PAGE) {
    const page = (await publicClient.readContract({
      address: CONTRACTS.vault,
      abi: VAULT_ABI,
      functionName: "beneficiariesOf",
      args: [token, start, PAGE],
    })) as readonly Address[];
    for (const b of page) {
      sum += (await publicClient.readContract({
        address: CONTRACTS.vault,
        abi: VAULT_ABI,
        functionName: "ledgerOf",
        args: [b, token],
      })) as bigint;
    }
  }

  const totalHeld = (await publicClient.readContract({
    address: CONTRACTS.vault,
    abi: VAULT_ABI,
    functionName: "totalHeldOf",
    args: [token],
  })) as bigint;
  const balance = (await publicClient.readContract({
    address: token,
    abi: ERC20,
    functionName: "balanceOf",
    args: [CONTRACTS.vault],
  })) as bigint;

  assert.equal(sum, totalHeld, `${label}: enumerated ledger must equal totalHeld`);
  assert.ok(totalHeld <= balance, `${label}: sum(ledger)=${totalHeld} > balanceOf=${balance}`);
  return { sum, totalHeld, balance };
}

/**
 * Send a transaction with a MEASURED gas limit. Monad bills the gas LIMIT rather than gas
 * used, so a padded limit costs real MON — and a guessed one costs a silent out-of-gas
 * revert with empty revert data, which is how ~1.12M got mistaken for 500k once already.
 * Estimate, then add 30% headroom, and never hardcode.
 */
async function send(
  label: string,
  args: { address: Address; abi: unknown; functionName: string; args: unknown[] },
) {
  const gas = await publicClient.estimateContractGas({
    account: issuerAccount,
    address: args.address,
    abi: args.abi as never,
    functionName: args.functionName,
    args: args.args as never,
  });
  const hash = await wallet.writeContract({
    address: args.address,
    abi: args.abi as never,
    functionName: args.functionName,
    args: args.args as never,
    gas: (gas * 13n) / 10n,
    chain: monadTestnet,
    account: issuerAccount,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`      ${label}: ${hash} (gas est ${gas}, status ${receipt.status})`);
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  return receipt;
}

/**
 * Index until every stream's cursor has passed `block`, rather than assuming one pass is
 * enough.
 *
 * The system's actual guarantee is EVENTUAL mirror convergence, and asserting it after a
 * single `runIndexerOnce()` asserts something stronger that was never promised. That
 * distinction is not academic: this is what caught the cached-head bug in the indexer (viem
 * memoises eth_blockNumber for its polling interval, so a pass could read a head from before
 * a transaction that had already mined). With the bound in place the assertion still
 * compares the mirror to the chain field by field — it just waits for the convergence the
 * design promises instead of racing it.
 */
async function indexUpTo(block: bigint, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    await runIndexerOnce();
    const behind = (
      await Promise.all([
        getCursor("tlnb", DEPLOY_BLOCKS.tlnb),
        getCursor("vault", DEPLOY_BLOCKS.vault),
        getCursor("cam", DEPLOY_BLOCKS.cam),
      ])
    ).some((c) => c < block);
    if (!behind) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`indexer did not reach block ${block} within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** Decode a revert against the CAM's own ABI and return the custom error's name. */
function revertNameOf(err: unknown): string | null {
  let e = err as { raw?: unknown; data?: unknown; cause?: unknown } | undefined;
  let raw: Hex | null = null;
  for (let i = 0; i < 10 && e; i++, e = e.cause as typeof e) {
    if (typeof e.raw === "string") { raw = e.raw as Hex; break; }
    if (typeof e.data === "string") { raw = e.data as Hex; break; }
  }
  if (!raw || raw.length < 10) return null;
  for (const abi of [CAM_ABI, VAULT_ABI]) {
    try {
      return decodeErrorResult({ abi: abi as never, data: raw }).errorName;
    } catch {
      /* try the next ABI */
    }
  }
  return `unknown selector ${raw.slice(0, 10)}`;
}

/** Simulate a call that must revert, and assert it reverts with a specific named error. */
async function expectRevert(
  name: string,
  simulate: () => Promise<unknown>,
  expectedError: string,
): Promise<boolean> {
  return check(name, async () => {
    let reverted = false;
    let got: string | null = null;
    try {
      await simulate();
    } catch (err) {
      reverted = true;
      got = revertNameOf(err);
    }
    assert.ok(reverted, `expected a revert (${expectedError}) but the call simulated cleanly`);
    assert.equal(got, expectedError);
  });
}

function simulateExecute(actionId: bigint, holders: Address[], amounts: bigint[]) {
  return publicClient.simulateContract({
    account: issuerAccount,
    address: CONTRACTS.cam,
    abi: CAM_ABI,
    functionName: "executePayoutRun",
    args: [actionId, holders, amounts],
  });
}

// ===========================================================================
// PHASE A — deterministic, zero-gas, zero-write. Fails in seconds if wrong.
// ===========================================================================

phase("A. Deployment identity and wiring");

const ISSUER = await issuerAddress();

await check("addresses.json matches the frozen deployment and chainId 10143", () => {
  assert.equal(ADDRESSES.chainId, 10143);
  assert.equal(publicClient.chain!.id, 10143);
  assert.equal(CONTRACTS.vault, "0xb634379B2afdF12830eaef694cFeaE80fB0dFFB7");
  assert.equal(CONTRACTS.cam, "0xF897874bAe28443a60ef92741f7df504F90386b6");
});

await check("CAM and vault are wired to each other on-chain, not merely in a doc", async () => {
  const escrowOf = await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "escrow",
  });
  const depositorOf = await publicClient.readContract({
    address: CONTRACTS.vault, abi: VAULT_ABI, functionName: "authorizedDepositor",
  });
  assert.equal(lc(escrowOf as string), lc(CONTRACTS.vault), "CAM.escrow() must be the vault");
  assert.equal(lc(depositorOf as string), lc(CONTRACTS.cam), "vault.authorizedDepositor() must be the CAM");
});

await check("the signing key is the issuer/owner of both contracts", async () => {
  const camOwner = await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "owner",
  });
  assert.equal(lc(issuerAccount.address), lc(camOwner as string));
  assert.equal(lc(ISSUER), lc(issuerAccount.address));
});

await check("aUSDC is allowlisted as a payment token; TLNB deliberately is not", async () => {
  const payOk = await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "allowedToken", args: [CONTRACTS.aUSDC],
  });
  const assetOk = await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "allowedToken", args: [CONTRACTS.tlnb],
  });
  assert.equal(payOk, true, "aUSDC must be allowlisted");
  assert.equal(assetOk, false, "TLNB is the ASSET, never a payment token — it must not be allowlisted");
});

phase("B. Reason taxonomy stays separated across every layer");

/**
 * The three eligibility selectors must never collapse into one another. Conflating expired
 * with frozen would falsify this project's central claim — that it does not conflate
 * lapsed-with-sanctioned — using its own on-chain audit trail. So the separation is checked
 * at each layer it passes through: contract constant, decoder, database CHECK, /escrow label.
 */
const REASONS = {
  frozen: (await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "REASON_FROZEN",
  })) as Hex,
  expired: (await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "REASON_EXPIRED",
  })) as Hex,
  returnedFalse: (await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "REASON_RETURNED_FALSE",
  })) as Hex,
  unknown: (await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "REASON_UNKNOWN_REVERT",
  })) as Hex,
};

await check("deployed contract's four reason tags are all distinct", () => {
  const vals = Object.values(REASONS);
  assert.equal(new Set(vals).size, 4, `four tags collapsed to ${new Set(vals).size}: ${vals}`);
});

await check("REASON_FROZEN and REASON_EXPIRED are the real, different A-Pass selectors", () => {
  assert.equal(REASONS.frozen, APASS_NOT_ACTIVE_SELECTOR);
  assert.equal(REASONS.expired, APASS_EXPIRED_SELECTOR);
  assert.notEqual(REASONS.frozen, REASONS.expired);
});

await check("the decoder classifies all three eligibility selectors distinctly", () => {
  assert.equal(classifyApassSelector(APASS_NOT_ACTIVE_SELECTOR), "frozen");
  assert.equal(classifyApassSelector(APASS_EXPIRED_SELECTOR), "expired");
  assert.equal(classifyApassSelector(NO_APASS_SELECTOR), "no_apass");
  assert.equal(classifyApassSelector("0xdeadbeef"), "other");
  assert.equal(new Set([APASS_NOT_ACTIVE_SELECTOR, APASS_EXPIRED_SELECTOR, NO_APASS_SELECTOR]).size, 3);
});

{
  /**
   * The insert MUST fail, and it must fail for the right reason.
   *
   * "It threw, therefore the constraint works" is the exact mistake this project has
   * already logged once: a probe that fails is not proof the thing behind it works — you
   * have to get the SPECIFIC failure you expected. A transport error (`TypeError: fetch
   * failed`, seen live on a re-run) would otherwise be read as a successful rejection,
   * quietly certifying a constraint that might not exist. So only Postgres error 23514
   * counts, and a network failure is retried and then reported as untested.
   */
  let pgCode: string | undefined;
  let transport: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db.from("escrow_deposits").insert({
      tx_hash: "0x" + "00".repeat(32), log_index: 999999, block_number: 1,
      beneficiary: NON_PARTICIPANT.toLowerCase(), token: lc(CONTRACTS.aUSDC),
      amount: "1", action_id: 0, reason_selector: "0xdeadbeef",
    });
    if (error?.code) { pgCode = error.code; transport = undefined; break; }
    transport = error ? error.message : "the insert SUCCEEDED";
    await new Promise((r) => setTimeout(r, 1_000));
  }

  if (transport && !pgCode && transport !== "the insert SUCCEEDED") {
    skip(
      "the database CHECK rejects a reason selector the contract cannot emit",
      `Supabase was unreachable across 3 attempts (${transport}), so the rejection could not ` +
        `be attributed to the CHECK constraint rather than to the network. Reported as ` +
        `untested rather than counted as a pass — a probe that fails is not proof.`,
    );
  } else {
    await check("the database CHECK rejects a reason selector the contract cannot emit", () => {
      assert.equal(pgCode, "23514", `expected a CHECK violation; got ${pgCode ?? transport}`);
    });
  }
}

phase("C. Commitment binding — every field of the seed, and both hash orderings");

const seedBase = {
  chainId: 10143n,
  cam: CONTRACTS.cam,
  actionId: 7n,
  token: CONTRACTS.aUSDC,
  asset: CONTRACTS.tlnb,
  recordBlock: 49_500_000n,
};
const baseSeed = commitmentSeed(seedBase);

await check("the seed binds chainid, CAM, actionId, token, asset and recordBlock — each alone", () => {
  const mutations: [string, Parameters<typeof commitmentSeed>[0]][] = [
    ["chainId", { ...seedBase, chainId: 1n }],
    ["cam", { ...seedBase, cam: CONTRACTS.vault }],
    ["actionId", { ...seedBase, actionId: 8n }],
    ["token", { ...seedBase, token: CONTRACTS.tlnb }],
    ["asset", { ...seedBase, asset: CONTRACTS.aUSDC }],
    ["recordBlock", { ...seedBase, recordBlock: 49_500_001n }],
  ];
  for (const [field, mutated] of mutations) {
    assert.notEqual(commitmentSeed(mutated), baseSeed, `changing ${field} must change the seed`);
  }
  // And the seed must be a pure function of exactly those six.
  assert.equal(commitmentSeed({ ...seedBase }), baseSeed);
});

await check("batch boundaries and intra-batch order each change the commitment", () => {
  const included = [
    { holder: "0x1111111111111111111111111111111111111111", entitlement: 5n },
    { holder: "0x2222222222222222222222222222222222222222", entitlement: 3n },
    { holder: "0x3333333333333333333333333333333333333333", entitlement: 2n },
  ];
  const base = { ...seedBase, included, batchSize: 50 };
  const one = buildBatches(base);
  const split = buildBatches({ ...base, batchSize: 2 });
  const reordered = buildBatches({ ...base, included: [included[1], included[0], included[2]] });

  assert.equal(one.length, 1);
  assert.equal(split.length, 2);
  assert.notEqual(split[split.length - 1].expectedHash, one[0].expectedHash, "boundaries must matter");
  assert.notEqual(reordered[0].expectedHash, one[0].expectedHash, "intra-batch order must matter");
});

await check("batches executed out of committed order cannot reach the committed hash", () => {
  const included = [
    { holder: "0x1111111111111111111111111111111111111111", entitlement: 5n },
    { holder: "0x2222222222222222222222222222222222222222", entitlement: 3n },
    { holder: "0x3333333333333333333333333333333333333333", entitlement: 2n },
    { holder: "0x4444444444444444444444444444444444444444", entitlement: 1n },
  ];
  const batches = buildBatches({ ...seedBase, included, batchSize: 2 });
  const committed = batches[batches.length - 1].expectedHash;

  // Replay the SAME batches in the wrong order and chain them the way the contract would.
  const swapped = chainStep(
    chainStep(baseSeed, batches[1].holders, batches[1].amounts),
    batches[0].holders,
    batches[0].amounts,
  );
  assert.notEqual(swapped, committed, "out-of-order execution must make full close impossible");
});

phase("D. Indexer: 100-block cap, catch-up, and (tx_hash, log_index) idempotency");

const head0 = await publicClient.getBlockNumber();

await check("Monad really does cap eth_getLogs at a 100-block range", async () => {
  let threw = false;
  let message = "";
  try {
    await publicClient.getLogs({
      address: CONTRACTS.tlnb, fromBlock: head0 - 150n, toBlock: head0,
    });
  } catch (err) {
    threw = true;
    message = (err as Error).message;
  }
  assert.ok(threw, "a 151-block getLogs must be rejected — if not, the pager's premise changed");
  assert.match(message, /100 range|limited to a 100/i);
});

await check("paginatedGetLogsForEvents pages a >100 block range and never exceeds the cap", async () => {
  const spans: bigint[] = [];
  let from = head0 - 250n;
  await paginatedGetLogsForEvents({
    address: CONTRACTS.tlnb,
    events: [
      { type: "event", name: "Transfer", inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ] },
    ],
    fromBlock: from,
    toBlock: head0,
    onPage: (lastBlockScanned) => {
      spans.push(lastBlockScanned - from + 1n);
      from = lastBlockScanned + 1n;
    },
  });
  assert.ok(spans.length >= 3, `expected >=3 pages over 251 blocks, got ${spans.length}`);
  for (const s of spans) assert.ok(s <= 100n, `a page spanned ${s} blocks, over the 100 cap`);
});

console.log("      running indexer to catch up...");
await runIndexerOnce({ onProgress: (m) => console.log(`   ${m}`) });

const CURSOR_TOLERANCE_BLOCKS = 500n;
let cursors: Record<string, bigint> = {};
await check(`indexer cursor lag within ${CURSOR_TOLERANCE_BLOCKS} blocks on every stream`, async () => {
  const head = await publicClient.getBlockNumber();
  cursors = {
    tlnb: await getCursor("tlnb", DEPLOY_BLOCKS.tlnb),
    vault: await getCursor("vault", DEPLOY_BLOCKS.vault),
    cam: await getCursor("cam", DEPLOY_BLOCKS.cam),
  };
  for (const [name, c] of Object.entries(cursors)) {
    const lag = head - c;
    assert.ok(lag <= CURSOR_TOLERANCE_BLOCKS, `${name} cursor is ${lag} blocks behind head ${head}`);
  }
});

await check("cap table reconciles: sum(balanceOf) over the indexed set == totalSupply", async () => {
  const recon = await get("/debug/reconcile");
  assert.equal(recon.status, 200);
  assert.equal(recon.body.shortfall, "0", `cap table is short: ${recon.body.problem ?? ""}`);
  assert.ok(Number(recon.body.holderCount) > 0);
});

/**
 * Idempotency, tested the only way that actually proves it: rewind the cursor over a range
 * that definitely contains logs, re-run, and assert not one extra row appeared. At-least-once
 * delivery producing exactly-once state is the property the whole crash-safety design rests
 * on, and it is invisible to any test that only ever indexes forward.
 */
async function rowCounts() {
  const one = async (t: string) => {
    const { count } = await db.from(t).select("*", { count: "exact", head: true });
    return count ?? 0;
  };
  return {
    asset_transfers: await one("asset_transfers"),
    payout_events: await one("payout_events"),
    escrow_deposits: await one("escrow_deposits"),
    escrow_releases: await one("escrow_releases"),
  };
}

await check("re-indexing the same range twice inserts zero duplicate rows", async () => {
  const before = await rowCounts();
  const rewindTo = cursors.tlnb - 300n;
  for (const name of ["tlnb", "vault", "cam"]) {
    await db.from("indexer_cursor").upsert({
      name, last_block: Number(rewindTo), updated_at: new Date().toISOString(),
    });
  }
  await runIndexerOnce();
  const after = await rowCounts();
  assert.deepEqual(after, before, "a rescanned range must be a no-op, not a duplicate insert");
});

phase("E. Prepare: refusals first, then the real plan");

const recordBlock = (await getCursor("tlnb", DEPLOY_BLOCKS.tlnb)) - 5n;
const TOTAL_AMOUNT = 100n; // raw aUSDC units — small on purpose, so this test stays re-runnable
const BATCH_SIZE = 4; // forces TWO batches over the 7-holder set, exercising the hash chain

await check("stale cursor: a record block ahead of the indexer is refused, naming the gap", async () => {
  const futureRecord = (await publicClient.getBlockNumber()) + 5_000n;
  const res = await post("/actions/prepare", {
    recordBlock: futureRecord.toString(), totalAmount: TOTAL_AMOUNT.toString(),
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "STALE_INDEX");
  assert.match(String(res.body.error), /block\(s\) behind/);
  // Must NOT read like the actionId clash — that wording sent an operator hunting a race
  // that did not exist while the real problem was an indexer sitting still.
  assert.doesNotMatch(String(res.body.error), /declared concurrently|already declared/i);
});

await check("over-budget: entitlements above the issuer's balance are blocked BEFORE any hash", async () => {
  const predicted = Number(await publicClient.readContract({
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "actionsCount",
  }));
  const res = await post("/actions/prepare", {
    recordBlock: recordBlock.toString(), totalAmount: "100000000000",
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "ISSUER_INSUFFICIENT_BALANCE");
  // The point of "before the hash is committed": nothing was persisted for that id.
  const row = await mirrorRow(predicted);
  assert.equal(row, null, "a refused prepare must not leave a plan behind");
});

await check("zero totalAmount is a 400, distinct from every 409", async () => {
  const res = await post("/actions/prepare", { recordBlock: recordBlock.toString(), totalAmount: "0" });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "ZERO_TOTAL_AMOUNT");
});

const prep = await post("/actions/prepare", {
  recordBlock: recordBlock.toString(),
  totalAmount: TOTAL_AMOUNT.toString(),
  batchSize: BATCH_SIZE,
});

const prepOk = await check("prepare succeeds — the 409 that bricked this route is gone", () => {
  assert.equal(prep.status, 200, `prepare failed: ${fmt(prep.body)}`);
});
if (!prepOk) {
  report();
  process.exit(1);
}

const ACTION_ID = Number(prep.body.actionId);
const batchesPlanned = prep.body.batches as { batchIndex: number; holders: number; batchTotal: string; expectedHash: Hex }[];
const excluded = prep.body.excluded as { holder: string; assetBalance: string; reason: string }[];

await check("prepare persists status 'Prepared' — a plan, never a declaration", async () => {
  assert.equal(prep.body.status, "Prepared");
  const row = await mirrorRow(ACTION_ID);
  assert.ok(row, "no plan row persisted");
  assert.equal(row!.status, "Prepared");
  assert.equal(row!.declare_tx_hash, null, "a plan has no declaring transaction");
  // The chain agrees it does not exist yet. This is the pair of facts the original bug
  // allowed to disagree.
  const chain = await getActionOnChain(ACTION_ID);
  assert.equal(chain.status, 0, "the predicted id must not exist on-chain yet");
});

await check("holder set, dust exclusion and sumEntitlements are internally consistent", async () => {
  const sum = BigInt(prep.body.sumEntitlements as string);
  const planned = batchesPlanned.reduce((a, b) => a + BigInt(b.batchTotal), 0n);
  assert.equal(sum, planned, "sumEntitlements must equal the sum of the batch totals");
  assert.ok(sum <= TOTAL_AMOUNT, `entitlements ${sum} exceed the declared budget ${TOTAL_AMOUNT}`);

  const totalHolders = Number(prep.body.totalHolders);
  const inBatches = batchesPlanned.reduce((a, b) => a + b.holders, 0);
  assert.equal(inBatches, totalHolders, "every included holder must appear in exactly one batch");
  assert.ok(batchesPlanned.length >= 2, `batchSize ${BATCH_SIZE} should produce >=2 batches`);

  // The dust holder is EXCLUDED WITH A REASON, not silently dropped.
  assert.ok(excluded.length >= 1, "the 5-unit dust holder must appear as an exclusion");
  const dust = excluded.find((e) => e.reason === "rounds_to_zero");
  assert.ok(dust, `no rounds_to_zero exclusion found; got ${fmt(excluded.map((e) => e.reason))}`);

  const { data: snap } = await db.from("record_date_snapshots").select("*").eq("action_id", ACTION_ID);
  assert.equal((snap ?? []).length, totalHolders + excluded.length, "snapshot must keep excluded rows");
  for (const row of snap ?? []) {
    if (!row.included) assert.ok(row.exclusion_reason, "an excluded holder must carry a reason");
  }
});

await check("structurally banned addresses never reach the hash", async () => {
  const { data: batchRows } = await db.from("action_batches").select("*").eq("action_id", ACTION_ID).order("batch_index");
  const all = (batchRows ?? []).flatMap((b) => (b.holders as string[]).map(lc));
  const banned = [
    "0x0000000000000000000000000000000000000000",
    lc(CONTRACTS.vault), lc(CONTRACTS.cam), lc(CONTRACTS.tlnb), lc(CONTRACTS.aUSDC),
  ];
  for (const b of banned) assert.ok(!all.includes(b), `banned address ${b} is inside a committed batch`);
  assert.equal(new Set(all).size, all.length, "a holder appears twice across batches");
});

// ===========================================================================
// PHASE F — chain writes begin here.
// ===========================================================================

phase("F. Declare on-chain, and the predicted id must be the real one");

const declareReceipt = await send("declareAction", {
  address: CONTRACTS.cam,
  abi: CAM_ABI,
  functionName: "declareAction",
  args: [
    CONTRACTS.aUSDC,
    CONTRACTS.tlnb,
    recordBlock,
    TOTAL_AMOUNT,
    prep.body.holderSetHash as Hex,
    Number(prep.body.totalHolders),
    0n,
  ],
});

/** Everything this run declares must end up Closed, whatever happens in between. */
const declaredIds: number[] = [ACTION_ID];

await check("actionId from the ActionDeclared receipt equals the predicted id", () => {
  const declared = declareReceipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: CAM_ABI as never, data: log.data, topics: log.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "ActionDeclared");
  assert.ok(declared, "no ActionDeclared event in the receipt");
  const args = declared!.args as unknown as { actionId: bigint; holderSetHash: Hex };
  assert.equal(Number(args.actionId), ACTION_ID, "the seed binds actionId — a mismatch invalidates the plan");
  assert.equal(args.holderSetHash, prep.body.holderSetHash, "declared hash differs from the planned one");
});

await indexUpTo(declareReceipt.blockNumber);

await check("the indexer promotes Prepared -> Declared, and the mirror equals getAction()", async () => {
  const row = await mirrorRow(ACTION_ID);
  assert.equal(row!.status, "Declared", "only the ActionDeclared event may promote a plan");
  assert.equal(lc(row!.declare_tx_hash as string), lc(declareReceipt.transactionHash));
  await assertMirrorMatchesChain(ACTION_ID, "after declare");
});

await check("GET /actions/:id agrees with the chain and reports parity honestly", async () => {
  const res = await get(`/actions/${ACTION_ID}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "Declared");
  assert.equal(res.body.commitmentParity, false, "parity cannot hold before any batch executes");
  assert.equal((res.body.batches as unknown[]).length, batchesPlanned.length);
});

phase("G. Batch calldata is served from the frozen plan, never recomputed");

const servedBatches: { holders: Address[]; amounts: bigint[] }[] = [];

await check("served calldata is byte-identical to the stored plan and hashes to the chain's commitment", async () => {
  let running = commitmentSeed({
    chainId: 10143n, cam: CONTRACTS.cam, actionId: BigInt(ACTION_ID),
    token: CONTRACTS.aUSDC, asset: CONTRACTS.tlnb, recordBlock,
  });

  for (const planned of batchesPlanned) {
    const res = await get(`/actions/${ACTION_ID}/batch-calldata?index=${planned.batchIndex}`);
    assert.equal(res.status, 200);
    assert.equal(lc(res.body.to as string), lc(CONTRACTS.cam));

    const decoded = decodeFunctionData({
      abi: parseAbi(["function executePayoutRun(uint256 actionId, address[] holders, uint256[] amounts)"]),
      data: res.body.calldata as Hex,
    });
    const [id, holders, amounts] = decoded.args as [bigint, Address[], bigint[]];
    assert.equal(Number(id), ACTION_ID);

    // The stored plan is the ONLY source. Compare against the database row directly.
    const { data: stored } = await db.from("action_batches").select("*")
      .eq("action_id", ACTION_ID).eq("batch_index", planned.batchIndex).maybeSingle();
    assert.deepEqual(holders.map(lc), (stored!.holders as string[]).map(lc), "calldata holders differ from the stored plan");
    assert.deepEqual(amounts.map(String), (stored!.amounts as string[]).map(String), "calldata amounts differ from the stored plan");

    running = chainStep(running, holders, amounts);
    assert.equal(running, stored!.expected_hash, "stored expectedHash is not the chained hash of its own batch");
    servedBatches.push({ holders, amounts });
  }

  const chain = await getActionOnChain(ACTION_ID);
  assert.equal(running, chain.holderSetHash, "the served batches do not chain to the on-chain commitment");
});

await check("a batch index with no stored plan is refused, never synthesized", async () => {
  const res = await get(`/actions/${ACTION_ID}/batch-calldata?index=${batchesPlanned.length + 5}`);
  assert.equal(res.status, 404, "recomputing a missing batch would silently break the commitment");
});

phase("H. THE THESIS: freeze a holder MID-FLIGHT, between record date and pay date");

let driftHolderAmount = 0n;
let driftBatchIndex = -1;
for (let i = 0; i < servedBatches.length; i++) {
  const j = servedBatches[i].holders.findIndex((h) => lc(h) === DRIFT_HOLDER);
  if (j >= 0) {
    driftHolderAmount = servedBatches[i].amounts[j];
    driftBatchIndex = i;
  }
}

const driftOk = await check("the drift holder is in the committed set and was ELIGIBLE at record date", async () => {
  assert.ok(DRIFT_HOLDER, "no HOLDER2_FREEZABLE_ADDRESS available");
  assert.ok(driftBatchIndex >= 0, `${DRIFT_HOLDER} is not in any committed batch — nothing to prove`);
  assert.ok(driftHolderAmount > 0n, "the drift holder's entitlement rounds to zero");
  // The whole point: this holder was payable when the action was declared. A test that
  // escrows an already-frozen holder proves nothing about eligibility drift.
  const state = await probeEligibility(DRIFT_HOLDER);
  assert.equal(state, "active", `drift holder must start eligible, was "${state}"`);
});

if (driftOk) {
  await check("freezing takes effect ON-CHAIN, not merely in a Cleanverse 200", async () => {
    const res = await cleanverse.updateStatus({
      status: "2",
      blacklistReason: "talon-flow-e2e",
      wallet: { address: DRIFT_HOLDER, chain: "monad" },
    });
    assert.equal(res.code, "0000", `update_status freeze failed: ${res.message}`);
    // A 200 is "request accepted", never "state changed". Only the token's own behaviour
    // flipping proves the freeze landed.
    await awaitFreezeState(DRIFT_HOLDER, true, {
      onProgress: (p) => console.log(`      ${formatWriteProgress(p)}`),
    });
  });

  await check("the SENDER side is checked too — a frozen wallet cannot send either", async () => {
    // This is the property /vault-health exists for: if the vault's own A-Pass ever lapsed,
    // every beneficiary's claim would break at once. Proven here on a wallet we can safely
    // freeze rather than on the vault, which would brick real claims.
    let name: string | null = null;
    try {
      await publicClient.simulateContract({
        account: DRIFT_HOLDER as Address,
        address: CONTRACTS.aUSDC, abi: ERC20, functionName: "transfer",
        args: [ISSUER, 1n],
      });
    } catch (err) {
      name = revertNameOf(err);
    }
    assert.ok(name, "a frozen wallet must not be able to send");
    assert.match(String(name), /APassNotActive|unknown selector 0x322fde89/);
  });

  await check("the poller reflects the freeze as FROZEN, with expiry kept separate", async () => {
    await runPollerOnce();
    const res = await get("/holders");
    const row = (res.body.holders as Record<string, unknown>[]).find(
      (h) => lc(String(h.wallet)) === DRIFT_HOLDER,
    );
    assert.ok(row, "the drift holder vanished from the cap table");
    assert.equal(row!.displayState, "frozen");
    assert.equal(row!.isFrozen, true);
    assert.equal(row!.isExpired, false, "frozen must never be reported as expired");
  });
}

phase("I. Execute the payout run");

const eligibilityBefore = new Map<string, string>();
for (const b of servedBatches) {
  for (const h of b.holders) eligibilityBefore.set(lc(h), await probeEligibility(lc(h)));
}
console.log(`      pre-flight eligibility: ${fmt([...eligibilityBefore.entries()])}`);

const execReceipts: Awaited<ReturnType<typeof send>>[] = [];
for (let i = 0; i < servedBatches.length; i++) {
  execReceipts.push(
    await send(`executePayoutRun batch ${i}`, {
      address: CONTRACTS.cam,
      abi: CAM_ABI,
      functionName: "executePayoutRun",
      args: [BigInt(ACTION_ID), servedBatches[i].holders, servedBatches[i].amounts],
    }),
  );
}

await check("every holder's on-chain status matches its pre-flight eligibility", async () => {
  for (const [holder, state] of eligibilityBefore) {
    const status = (await publicClient.readContract({
      address: CONTRACTS.cam, abi: CAM_ABI, functionName: "holderStatusOf",
      args: [BigInt(ACTION_ID), holder as Address],
    })) as number;
    const want = state === "active" ? 1 : 2; // 1 = Paid, 2 = Escrowed
    assert.equal(status, want, `${holder} was "${state}" pre-flight but got status ${status}`);
  }
});

await check("the drift holder is ESCROWED with the FROZEN reason and named as the offender", async () => {
  const ledger = (await publicClient.readContract({
    address: CONTRACTS.vault, abi: VAULT_ABI, functionName: "ledgerOf",
    args: [DRIFT_HOLDER as Address, CONTRACTS.aUSDC],
  })) as bigint;
  assert.equal(ledger, driftHolderAmount, "the escrowed amount must equal the committed entitlement");

  const dep = execReceipts[driftBatchIndex].logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: VAULT_ABI as never, data: log.data, topics: log.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === "Deposited" &&
      lc(String((e.args as unknown as { beneficiary: string }).beneficiary)) === DRIFT_HOLDER);
  assert.ok(dep, "no Deposited event for the drift holder");
  const a = dep!.args as unknown as { reasonSelector: Hex; offender: Address; amount: bigint };
  assert.equal(a.reasonSelector, REASONS.frozen, "a frozen holder must be tagged FROZEN, never EXPIRED or UNKNOWN");
  assert.equal(lc(a.offender), DRIFT_HOLDER, "the revert names the offender; the escrow record must keep it");
  assert.equal(a.amount, driftHolderAmount);
});

await assertVaultInvariant("after execute").then(
  (r) => pass(`vault invariant holds after execute (held ${r.totalHeld} <= balance ${r.balance})`),
  (e) => fail("vault invariant holds after execute", "sum(ledger) <= balanceOf", (e as Error).message),
);

await indexUpTo(execReceipts[execReceipts.length - 1].blockNumber);

await check("payout_events mirror the on-chain legs exactly, reason selectors intact", async () => {
  const chain = await getActionOnChain(ACTION_ID);
  const { data: events } = await db.from("payout_events").select("*").eq("action_id", ACTION_ID);
  const paid = (events ?? []).filter((e) => e.outcome === "paid");
  const escrowed = (events ?? []).filter((e) => e.outcome === "escrowed");

  assert.equal(paid.length, chain.paidCount, "mirror paid legs != on-chain paidCount");
  assert.equal(escrowed.length, chain.escrowedCount, "mirror escrowed legs != on-chain escrowedCount");
  assert.equal(paid.length + escrowed.length, chain.nextIndex, "mirror legs != holders processed on-chain");

  const drift = escrowed.find((e) => lc(e.holder) === DRIFT_HOLDER);
  assert.ok(drift, "the drift holder has no escrowed payout_event");
  assert.equal(drift!.reason_selector, REASONS.frozen);
  assert.equal(BigInt(drift!.amount), driftHolderAmount);
  for (const p of paid) assert.equal(p.reason_selector, null, "a paid leg must carry no reason");
});

await check("escrow_deposits keeps the offender, and the mirror equals getAction()", async () => {
  const { data: deps } = await db.from("escrow_deposits").select("*").eq("action_id", ACTION_ID);
  const drift = (deps ?? []).find((d) => lc(d.beneficiary) === DRIFT_HOLDER);
  assert.ok(drift, "no escrow_deposits row for the drift holder");
  assert.equal(drift!.reason_selector, REASONS.frozen);
  assert.equal(lc(drift!.offender as string), DRIFT_HOLDER);
  await assertMirrorMatchesChain(ACTION_ID, "after execute");
});

await check("GET /escrow shows the live ledger, the reason, and the invariant", async () => {
  const res = await get("/escrow");
  assert.equal(res.status, 200);
  const inv = res.body.invariant as Record<string, unknown>;
  assert.equal(inv.holds, true, "the route reports the vault invariant as violated");
  assert.equal(inv.statement, "sum(ledger) <= balanceOf(vault)");

  const live = (res.body.liveBalances as { beneficiary: string; held: string }[])
    .find((l) => lc(l.beneficiary) === DRIFT_HOLDER);
  assert.ok(live, "the drift holder is missing from the live escrow balances");
  assert.equal(BigInt(live!.held), driftHolderAmount);

  const dep = (res.body.deposits as Record<string, unknown>[])
    .find((d) => lc(String(d.beneficiary)) === DRIFT_HOLDER && Number(d.actionId) === ACTION_ID);
  assert.ok(dep, "the drift holder's deposit is missing from /escrow");
  assert.equal(dep!.onChainReason, "FROZEN", "the on-chain tag must be reported verbatim");
  assert.equal(dep!.decodedReason, "frozen");
  assert.equal(lc(String(dep!.offender)), DRIFT_HOLDER);
  assert.equal((res.body.counts as Record<string, number>).forfeited, 0, "nothing is ever forfeited");
});

await expectRevert(
  "replaying identical calldata reverts DuplicateHolder — the intended failsafe",
  () => simulateExecute(BigInt(ACTION_ID), servedBatches[0].holders, servedBatches[0].amounts),
  "DuplicateHolder",
);

phase("J. Recovery: unfreeze, release, and the ledger drains");

let releaseReceipt: Awaited<ReturnType<typeof send>> | null = null;

if (driftOk) {
  await check("unfreezing takes effect on-chain", async () => {
    const res = await cleanverse.updateStatus({
      status: "1", wallet: { address: DRIFT_HOLDER, chain: "monad" },
    });
    assert.equal(res.code, "0000", `update_status unfreeze failed: ${res.message}`);
    await awaitFreezeState(DRIFT_HOLDER, false, {
      onProgress: (p) => console.log(`      ${formatWriteProgress(p)}`),
    });
  });

  const balBefore = (await publicClient.readContract({
    address: CONTRACTS.aUSDC, abi: ERC20, functionName: "balanceOf", args: [DRIFT_HOLDER as Address],
  })) as bigint;

  releaseReceipt = await send("release (permissionless retry)", {
    address: CONTRACTS.vault,
    abi: VAULT_ABI,
    functionName: "release",
    args: [DRIFT_HOLDER as Address, CONTRACTS.aUSDC],
  });

  await check("release drains the ledger to the beneficiary, never to the caller", async () => {
    const ledger = (await publicClient.readContract({
      address: CONTRACTS.vault, abi: VAULT_ABI, functionName: "ledgerOf",
      args: [DRIFT_HOLDER as Address, CONTRACTS.aUSDC],
    })) as bigint;
    const balAfter = (await publicClient.readContract({
      address: CONTRACTS.aUSDC, abi: ERC20, functionName: "balanceOf", args: [DRIFT_HOLDER as Address],
    })) as bigint;
    assert.equal(ledger, 0n, "the ledger entry must be zeroed");
    assert.equal(balAfter - balBefore, driftHolderAmount, "the beneficiary must receive exactly the escrowed amount");
  });

  await assertVaultInvariant("after release").then(
    (r) => pass(`vault invariant holds after release (held ${r.totalHeld} <= balance ${r.balance})`),
    (e) => fail("vault invariant holds after release", "sum(ledger) <= balanceOf", (e as Error).message),
  );

  await check("a second release reverts NothingOwed rather than paying twice", async () => {
    let name: string | null = null;
    try {
      await publicClient.simulateContract({
        account: issuerAccount, address: CONTRACTS.vault, abi: VAULT_ABI,
        functionName: "release", args: [DRIFT_HOLDER as Address, CONTRACTS.aUSDC],
      });
    } catch (err) {
      name = revertNameOf(err);
    }
    assert.equal(name, "NothingOwed");
  });

  await indexUpTo(releaseReceipt.blockNumber);

  await check("the release is mirrored, with its attribution labelled as inferred or certain", async () => {
    const { data: rel } = await db.from("escrow_releases").select("*")
      .eq("tx_hash", lc(releaseReceipt!.transactionHash)).maybeSingle();
    assert.ok(rel, "no escrow_releases row for the release tx");
    assert.equal(lc(rel!.beneficiary as string), DRIFT_HOLDER);
    assert.equal(BigInt(rel!.amount as string), driftHolderAmount);
    assert.equal(lc(rel!.trigger_address as string), lc(issuerAccount.address));
    // Released carries no actionId. The mirror must say so rather than assert a fact.
    assert.equal(typeof rel!.attribution_certain, "boolean");
    if (!rel!.attribution_certain) assert.ok(rel!.inferred_action_id !== undefined);
  });
}

phase("K. Close: coverage and commitment parity");

const closeReceipt = await send("closeAction", {
  address: CONTRACTS.cam, abi: CAM_ABI, functionName: "closeAction", args: [BigInt(ACTION_ID)],
});

await check("closeAction proves full coverage: runningHash == holderSetHash", async () => {
  const chain = await getActionOnChain(ACTION_ID);
  assert.equal(chain.status, 3, "action must be Closed");
  assert.equal(chain.runningHash, chain.holderSetHash, "the chained commitment did not verify");
  assert.equal(chain.nextIndex, chain.totalHolders, "coverage is incomplete");
});

await indexUpTo(closeReceipt.blockNumber);

await check("the mirror records coverage_complete and parity, still equal to the chain", async () => {
  await assertMirrorMatchesChain(ACTION_ID, "after close");
  const row = await mirrorRow(ACTION_ID);
  assert.equal(row!.status, "Closed");
  assert.equal(row!.coverage_complete, true);
  assert.equal(row!.running_hash, row!.holder_set_hash);

  const res = await get(`/actions/${ACTION_ID}`);
  assert.equal(res.body.commitmentParity, true);
});

await expectRevert(
  "a late batch after close is refused",
  () => simulateExecute(BigInt(ACTION_ID), servedBatches[0].holders, servedBatches[0].amounts),
  "InvalidActionStatus",
);

phase("L. Audit pack: reports where earned, refusal where not");

const paidLegTx = execReceipts[0].transactionHash;

await check("the audit pack fetches stored report bytes for a paid leg only", async () => {
  const res = await get(`/actions/${ACTION_ID}/audit?fetchReports=true`);
  assert.equal(res.status, 200);
  const legs = res.body.legs as Record<string, unknown>[];
  assert.ok(legs.length > 0, "the audit pack has no legs");

  const paid = legs.filter((l) => l.outcome === "paid");
  const escrowed = legs.filter((l) => l.outcome === "escrowed");
  assert.ok(paid.length > 0, "no paid legs to report on");

  for (const l of paid) {
    assert.equal(l.participationVerified, true, `${l.holder} was paid but is not in the tx's Transfer logs`);
    assert.equal(l.reportEligible, true);
  }
  // An escrowed leg was never paid, so there is no payment to report. Saying so plainly
  // beats attaching an official-looking document to a transfer that did not happen.
  for (const l of escrowed) {
    assert.equal(l.reportEligible, false);
    assert.match(String(l.reportStatus), /escrowed, not transferred/);
  }

  const withBytes = paid.find((l) => (l.report as { stored?: boolean } | null)?.stored);
  assert.ok(withBytes, `no paid leg has stored report bytes; reports: ${fmt(paid.map((l) => l.report))}`);
});

await check("a stored report is served from our own database, as real bytes", async () => {
  const { data } = await db.from("cleanverse_reports").select("tx_hash,wallet")
    .eq("participation_verified", true).not("report_bytes", "is", null).limit(1).maybeSingle();
  assert.ok(data, "no participation-verified stored report to serve");
  const res = await app.inject({ method: "GET", url: `/reports/${data!.tx_hash}/${data!.wallet}` });
  assert.equal(res.statusCode, 200);
  assert.ok(res.rawPayload.length > 100, `report body was ${res.rawPayload.length} bytes`);
});

await check("a NON-PARTICIPANT is refused a report rather than handed a broken link", async () => {
  const res = await app.inject({ method: "GET", url: `/reports/${paidLegTx}/${lc(NON_PARTICIPANT)}` });
  assert.equal(res.statusCode, 404, "a wallet that never appeared in the tx must have no report");

  const audit = await get(`/actions/${ACTION_ID}/audit`);
  const legs = audit.body.legs as Record<string, unknown>[];
  assert.ok(
    !legs.some((l) => lc(String(l.holder)) === lc(NON_PARTICIPANT)),
    "a non-participant appears in the audit pack",
  );
});

await check("the participation check is LOAD-BEARING: Cleanverse itself does not enforce it", async () => {
  // The reason participation is checked against the transaction's own Transfer logs is that
  // download_travel_rule will happily issue a report for a wallet that was never in the tx.
  // If that ever stopped being true, this assertion should fail and the check could be
  // reconsidered — until then, it is the only thing standing between the audit pack and an
  // official-looking document attached to a payment that never happened.
  const res = await cleanverse.downloadTravelRule({
    txHash: paidLegTx,
    wallet: { address: NON_PARTICIPANT, chain: "monad" },
  });
  const url = (res.data as { downloadUrl?: string } | null)?.downloadUrl ?? null;
  assert.ok(url, `Cleanverse refused a non-participant report (code ${res.code}) — the upstream behaviour changed`);
});

phase("M. Execution-taxonomy failures that must NOT be smeared across holders");

/**
 * A decoy action, declared with a deliberately unreachable budget, used for the negative
 * simulations that need a live Declared action. Every one of these is an `eth_call`: no gas,
 * no state change, no holder marked. It is closed at the end as a pure cancel, which is
 * itself a listed edge case (Declared -> Closed with no execution is valid).
 */
const decoyId = Number(await publicClient.readContract({
  address: CONTRACTS.cam, abi: CAM_ABI, functionName: "actionsCount",
}));

await check("a genuine actionId clash is detected and reported as a clash, not as staleness", async () => {
  // Declare the decoy AFTER the previous prepare read actionsCount(), which is exactly the
  // race the gate exists for: the id this plan predicted is now taken.
  const decoyReceipt = await send("declareAction (decoy)", {
    address: CONTRACTS.cam, abi: CAM_ABI, functionName: "declareAction",
    args: [
      CONTRACTS.aUSDC, CONTRACTS.tlnb, recordBlock, 10_000_000_000n,
      keccak256("0x00" as Hex), 1, 0n,
    ],
  });
  declaredIds.push(decoyId);
  await indexUpTo(decoyReceipt.blockNumber);

  // Now force prepare to predict the id that was just taken, by asking for it directly:
  // the mirror row for `decoyId` is Declared with a real tx hash, and the chain agrees.
  const chain = await getActionOnChain(decoyId);
  assert.equal(chain.status, 1, "the decoy must be Declared on-chain");
  const row = await mirrorRow(decoyId);
  assert.equal(row!.status, "Declared");
  assert.ok(row!.declare_tx_hash, "a Declared row must carry its declaring tx");

  // A prepare run at this moment predicts decoyId + 1, so it must SUCCEED — proving the
  // gate blocks real clashes without becoming permanently stuck the way it did before.
  const res = await post("/actions/prepare", {
    recordBlock: recordBlock.toString(), totalAmount: TOTAL_AMOUNT.toString(),
  });
  assert.equal(res.status, 200, `prepare after a real declare must succeed: ${fmt(res.body)}`);
  assert.equal(Number(res.body.actionId), decoyId + 1, "the fresh id must be actionsCount()");
  // Clean up the throwaway plan so no orphan 'Prepared' row survives this run.
  await db.from("record_date_snapshots").delete().eq("action_id", decoyId + 1);
  await db.from("action_batches").delete().eq("action_id", decoyId + 1);
  await db.from("corporate_actions").delete().eq("action_id", decoyId + 1).eq("status", "Prepared");
});

const someHolder = servedBatches[0].holders[0];

await expectRevert(
  "issuer balance short -> the WHOLE batch reverts; no holder is smeared as the problem",
  () => simulateExecute(BigInt(decoyId), [someHolder], [9_000_000_000n]),
  "IssuerInsufficientBalance",
);

await expectRevert(
  "a banned holder (the vault) in a batch reverts InvalidHolder",
  () => simulateExecute(BigInt(decoyId), [CONTRACTS.vault], [1n]),
  "InvalidHolder",
);

await expectRevert(
  "the zero address in a batch reverts InvalidHolder",
  () => simulateExecute(BigInt(decoyId), ["0x0000000000000000000000000000000000000000"], [1n]),
  "InvalidHolder",
);

await expectRevert(
  "a zero amount reverts ZeroAmount",
  () => simulateExecute(BigInt(decoyId), [someHolder], [0n]),
  "ZeroAmount",
);

await expectRevert(
  "mismatched holders/amounts lengths revert LengthMismatch",
  () => simulateExecute(BigInt(decoyId), [someHolder, NON_PARTICIPANT], [1n]),
  "LengthMismatch",
);

await expectRevert(
  "a duplicate holder within one batch reverts DuplicateHolder",
  () => simulateExecute(BigInt(decoyId), [someHolder, someHolder], [1n, 1n]),
  "DuplicateHolder",
);

/**
 * Insufficient allowance, tested WITHOUT changing the live allowance.
 *
 * Reducing the issuer's real allowance and restoring it would leave the demo broken if this
 * run died in between, so the allowance slot is located empirically (the issuer's current
 * allowance is a known value) and overridden for a single `eth_call`. If the slot cannot be
 * found — aUSDC is unverified, so its storage layout is not documented — this is reported as
 * untested rather than asserted around.
 */
{
  const knownAllowance = (await publicClient.readContract({
    address: CONTRACTS.aUSDC, abi: ERC20, functionName: "allowance", args: [ISSUER, CONTRACTS.cam],
  })) as bigint;

  let slot: Hex | null = null;
  for (let i = 0n; i < 40n && slot === null; i++) {
    const outer = keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ISSUER, i]),
    );
    const inner = keccak256(
      ("0x" + pad(CONTRACTS.cam, { size: 32 }).slice(2) + outer.slice(2)) as Hex,
    );
    const value = await publicClient.getStorageAt({ address: CONTRACTS.aUSDC, slot: inner });
    if (value && BigInt(value) === knownAllowance && knownAllowance !== 0n) slot = inner;
  }

  if (slot === null) {
    skip(
      "issuer allowance short -> IssuerAllowanceTooLowForManager",
      "Could not locate aUSDC's allowance storage slot by scanning mapping slots 0-39, so the " +
        "shortfall could not be simulated via a state override. aUSDC is unverified on Sourcify " +
        "(chain 10143) and the Monad explorer is Cloudflare-gated, so its layout is not knowable " +
        "from source. The alternative — actually lowering the live allowance and restoring it — " +
        "was rejected: a crash between the two transactions would leave the demo unable to pay " +
        "anyone. Covered by Foundry tests 52/53 against a mock, but NOT proven against real aUSDC.",
    );
  } else {
    await expectRevert(
      "issuer allowance short -> the WHOLE batch reverts IssuerAllowanceTooLowForManager",
      () =>
        publicClient.simulateContract({
          account: issuerAccount,
          address: CONTRACTS.cam,
          abi: CAM_ABI,
          functionName: "executePayoutRun",
          args: [BigInt(decoyId), [someHolder], [1n]],
          stateOverride: [
            { address: CONTRACTS.aUSDC, stateDiff: [{ slot: slot!, value: pad("0x00", { size: 32 }) }] },
          ],
        }),
      "IssuerAllowanceTooLowForManager",
    );
  }
}

// --- issuer ineligible: the highest-risk assertion in the file, so it is last and guarded --
if (SKIP_ISSUER_FREEZE) {
  skip(
    "issuer ineligible -> the WHOLE batch reverts IssuerNotEligible",
    "SKIP_ISSUER_FREEZE=1 was set. Freezing the issuer's own A-Pass halts every payout in the " +
      "system while it is in effect, so this is opt-out-able for runs close to a demo.",
  );
} else {
  let frozeIssuer = false;
  try {
    const res = await cleanverse.updateStatus({
      status: "2", blacklistReason: "talon-flow-e2e-issuer",
      wallet: { address: ISSUER, chain: "monad" },
    });
    if (res.code === "0000") {
      await awaitFreezeState(ISSUER, true, {
        onProgress: (p) => console.log(`      ${formatWriteProgress(p)}`),
      });
      frozeIssuer = true;
      await expectRevert(
        "issuer ineligible -> the WHOLE batch reverts IssuerNotEligible, no holder escrowed",
        () => simulateExecute(BigInt(decoyId), [someHolder], [1n]),
        "IssuerNotEligible",
      );
    } else {
      skip("issuer ineligible -> IssuerNotEligible", `update_status refused: code ${res.code} ${res.message}`);
    }
  } catch (err) {
    fail("issuer ineligible -> IssuerNotEligible", "IssuerNotEligible", (err as Error).message);
  } finally {
    if (frozeIssuer) {
      // Non-negotiable. Leaving the issuer frozen breaks every payout path in the project.
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await cleanverse.updateStatus({ status: "1", wallet: { address: ISSUER, chain: "monad" } });
          await awaitFreezeState(ISSUER, false, {
            onProgress: (p) => console.log(`      ${formatWriteProgress(p)}`),
          });
          pass("issuer unfrozen and confirmed active on-chain again");
          break;
        } catch (err) {
          console.error(`      !! ISSUER STILL FROZEN (attempt ${attempt}/5): ${(err as Error).message}`);
          if (attempt === 5) {
            fail("issuer unfrozen and confirmed active on-chain again", "active", "STILL FROZEN",
              "MANUAL ACTION REQUIRED: unfreeze the issuer's A-Pass before any demo.");
          }
        }
      }
    }
  }
}

phase("N. Pure cancel, and no orphans left behind");

const decoyCloseReceipt = await send("closeAction (decoy, pure cancel from Declared)", {
  address: CONTRACTS.cam, abi: CAM_ABI, functionName: "closeAction", args: [BigInt(decoyId)],
});
await indexUpTo(decoyCloseReceipt.blockNumber);

await check("Declared -> Closed with no execution is a valid cancel, flagged incomplete", async () => {
  const chain = await getActionOnChain(decoyId);
  assert.equal(chain.status, 3, "the decoy must be Closed");
  assert.equal(chain.nextIndex, 0, "a pure cancel must have processed nobody");
  assert.equal(chain.paidCount, 0);
  assert.equal(chain.escrowedCount, 0);
  const row = await mirrorRow(decoyId);
  assert.equal(row!.status, "Closed");
  assert.equal(row!.coverage_complete, false, "a cancelled action must never look fully covered");
  await assertMirrorMatchesChain(decoyId, "after pure cancel");
});

await check("the vault's own A-Pass is healthy and monitored (senders are checked too)", async () => {
  const res = await get("/vault-health");
  assert.equal(res.status, 200);
  assert.equal(res.body.healthy, true, "the vault's credential is not active — every claim would break");
  assert.equal(res.body.eligibility, "active");
  assert.equal(res.body.apassStatus, 1);
  assert.ok(Number(res.body.daysLeft) > 30, `vault A-Pass expires in ${res.body.daysLeft} days`);
});

skip(
  "vault A-Pass LAPSE -> /vault-health raises the alarm",
  "Only the healthy path was exercised. Freezing the vault's own A-Pass to see the alarm fire " +
    "would block every beneficiary's claim system-wide for as long as it took to reverse, and " +
    "the reverse is an async Cleanverse write that has been observed lagging its own 200. The " +
    "sender-side check the alarm exists for IS proven live above, on a holder wallet we control.",
);

skip(
  "APassExpired (0xaecc0dbe) -> REASON_EXPIRED through indexer -> DB -> /escrow",
  "No wallet with a genuinely expired A-Pass was available during this run, and expiry cannot be " +
    "manufactured inside one: generate_apass takes an absolute expirationTime, so producing a real " +
    "lapse means issuing a short-lived credential and waiting it out. The separation of EXPIRED " +
    "from FROZEN IS verified above at every layer that can be checked without one (the deployed " +
    "contract's constants, the decoder, the database CHECK, /escrow's labels); what is unproven is " +
    "only the live end-to-end path, which was observed once for real on 2026-07-31.",
);

skip(
  "NoAPass (0xa6725971) -> tagged UNKNOWN_REVERT on-chain, annotated by the backend decoder",
  "Producing it needs a holder in the committed set with no A-Pass at all, which means minting " +
    "TLNB to a fresh wallet and re-indexing — that permanently changes the demo cap table, so it " +
    "was not done inside a test that must be re-runnable. The decoder's classification of the " +
    "selector is asserted above; the escrow path it would take is the same UNKNOWN_REVERT branch " +
    "the frozen contract already guarantees preserves the entitlement.",
);

phase("O. Re-runnability");

await check("no orphan 'Prepared' rows and no open actions survive this run", async () => {
  const { data: orphans } = await db.from("corporate_actions").select("action_id,status").eq("status", "Prepared");
  assert.deepEqual(orphans ?? [], [], "a plan was left behind — the next run would trip over it");

  for (const id of declaredIds) {
    const chain = await getActionOnChain(id);
    assert.equal(chain.status, 3, `action ${id} was declared but not closed`);
  }
  const { data: open } = await db.from("corporate_actions").select("action_id,status")
    .in("status", ["Declared", "Executing"]);
  assert.deepEqual(open ?? [], [], "an action is left open on-chain — exactly the mess this fixes");
});

await check("the drift holder ends the run eligible again", async () => {
  if (!driftOk) return;
  const state = await probeEligibility(DRIFT_HOLDER);
  assert.equal(state, "active", "the run must not leave a holder frozen");
});

const monLeft = await publicClient.getBalance({ address: issuerAccount.address });
const usdcLeft = (await publicClient.readContract({
  address: CONTRACTS.aUSDC, abi: ERC20, functionName: "balanceOf", args: [ISSUER],
})) as bigint;

// ---------------------------------------------------------------------------

function report() {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`1. PASSED (${passed.length})`);
  for (const p of passed) console.log(`   ✓ ${p}`);

  console.log(`\n2. FAILED (${failed.length})`);
  if (failed.length === 0) console.log("   none");
  for (const f of failed) {
    console.log(`   ✗ ${f.name}`);
    console.log(`       expected: ${fmt(f.expected)}`);
    console.log(`       actual:   ${fmt(f.actual)}`);
    if (f.detail) console.log(`       ${f.detail}`);
  }

  console.log(`\n3. NOT TESTED (${skipped.length})`);
  if (skipped.length === 0) console.log("   none");
  for (const s of skipped) console.log(`   ○ ${s.name}\n       ${s.why}`);
  console.log(`${"=".repeat(72)}`);
}

report();
console.log(
  `\nBudget after this run: ${monLeft} wei MON, ${usdcLeft} raw aUSDC held by the issuer.\n` +
    `Re-runnability is bounded by these, not by the test: each run costs roughly ` +
    `${TOTAL_AMOUNT} raw aUSDC and a handful of transactions.`,
);

await app.close();
process.exit(failed.length === 0 ? 0 : 1);
