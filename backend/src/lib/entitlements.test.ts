// Run with: npx tsx src/lib/entitlements.test.ts
//
// The commitment hash is the one piece of off-chain maths that MUST agree with the
// deployed contract byte for byte. If it disagrees, `declareAction` still succeeds, every
// `executePayoutRun` still succeeds, money moves — and only `closeAction` reverts with
// CoverageHashMismatch, at the very end, on stage.
//
// So this does not test against a fixture we invented. It reproduces the runningHash of
// action #0, a REAL action executed against the real deployed manager on Monad testnet,
// read live from the chain. If viem's encoding and Solidity's abi.encode ever disagree,
// this fails immediately and for an obvious reason.
import assert from "node:assert/strict";
import { parseAbi } from "viem";
import { publicClient, CONTRACTS } from "./chain.js";
import { commitmentSeed, chainStep, buildBatches } from "./entitlements.js";
import CAM_ABI from "../generated/CorporateActionManager.abi.json" with { type: "json" };

let passed = 0;
const ok = (n: string) => {
  console.log(`  ok  ${n}`);
  passed++;
};

// Action #0's real execution, as it happened on-chain:
//   one batch, two holders, one raw unit each; HOLDER1 paid, HOLDER2 escrowed (frozen).
// Both legs still advance the hash — escrowing is a payout outcome, not a skip.
const HOLDER1 = "0x924c33f763860e433fdc02A0158d2916e66b7410";
const HOLDER2 = "0x71b0C66ec7076bb27Cd4280b0AD0b1b88F7873c6";

const action = (await publicClient.readContract({
  address: CONTRACTS.cam,
  abi: CAM_ABI,
  functionName: "getAction",
  args: [0n],
})) as {
  token: `0x${string}`;
  asset: `0x${string}`;
  recordBlock: bigint;
  holderSetHash: `0x${string}`;
  runningHash: `0x${string}`;
  totalHolders: number;
};

console.log(`action #0 on-chain runningHash: ${action.runningHash}`);

// 1. Seed + one chain step must reproduce the real on-chain runningHash exactly.
{
  const seed = commitmentSeed({
    chainId: BigInt(publicClient.chain!.id),
    cam: CONTRACTS.cam,
    actionId: 0n,
    token: action.token,
    asset: action.asset,
    recordBlock: action.recordBlock,
  });
  const computed = chainStep(seed, [HOLDER1, HOLDER2], [1n, 1n]);

  assert.equal(
    computed,
    action.runningHash,
    "viem encoding disagrees with the deployed contract's abi.encode",
  );
  ok("reproduces action #0's real on-chain runningHash from seed + chain step");
}

// 2. buildBatches must produce that same hash through its normal code path — the path
//    /actions/prepare actually uses. Testing only the primitives would leave the wiring
//    between them untested, and that wiring is where batch boundaries get decided.
{
  const batches = buildBatches({
    actionId: 0n,
    token: action.token,
    asset: action.asset,
    recordBlock: action.recordBlock,
    included: [
      { holder: HOLDER1, entitlement: 1n },
      { holder: HOLDER2, entitlement: 1n },
    ],
    batchSize: 50,
    chainId: BigInt(publicClient.chain!.id),
    cam: CONTRACTS.cam,
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0].expectedHash, action.runningHash);
  assert.equal(batches[0].batchTotal, 2n);
  ok("buildBatches reaches the same hash through the real prepare code path");
}

// 3. A fully-covered action has runningHash == holderSetHash. This is what closeAction
//    checks, and reproducing it confirms we are computing the same quantity the contract
//    commits at declare time — not merely something self-consistent.
{
  assert.equal(action.runningHash, action.holderSetHash);
  ok("action #0 is fully covered: runningHash == holderSetHash, as closeAction requires");
}

// 4. Batch BOUNDARIES change the hash. Same holders, same amounts, same order — split
//    into two batches instead of one — must give a different commitment. This is why the
//    plan is frozen at declare time and calldata is served from it rather than recomputed.
{
  const oneBatch = buildBatches({
    actionId: 0n, token: action.token, asset: action.asset, recordBlock: action.recordBlock,
    included: [{ holder: HOLDER1, entitlement: 1n }, { holder: HOLDER2, entitlement: 1n }],
    batchSize: 50, chainId: BigInt(publicClient.chain!.id), cam: CONTRACTS.cam,
  });
  const twoBatches = buildBatches({
    actionId: 0n, token: action.token, asset: action.asset, recordBlock: action.recordBlock,
    included: [{ holder: HOLDER1, entitlement: 1n }, { holder: HOLDER2, entitlement: 1n }],
    batchSize: 1, chainId: BigInt(publicClient.chain!.id), cam: CONTRACTS.cam,
  });
  assert.equal(twoBatches.length, 2);
  assert.notEqual(
    twoBatches[twoBatches.length - 1].expectedHash,
    oneBatch[0].expectedHash,
    "batch boundaries must affect the commitment",
  );
  ok("batch boundaries change the commitment — the stored plan cannot be recomputed");
}

// 5. Intra-batch ORDER changes the hash too, for the same reason.
{
  const base = {
    actionId: 0n, token: action.token, asset: action.asset, recordBlock: action.recordBlock,
    batchSize: 50, chainId: BigInt(publicClient.chain!.id), cam: CONTRACTS.cam,
  };
  const forward = buildBatches({
    ...base,
    included: [{ holder: HOLDER1, entitlement: 1n }, { holder: HOLDER2, entitlement: 1n }],
  });
  const reversed = buildBatches({
    ...base,
    included: [{ holder: HOLDER2, entitlement: 1n }, { holder: HOLDER1, entitlement: 1n }],
  });
  assert.notEqual(reversed[0].expectedHash, forward[0].expectedHash);
  ok("intra-batch order changes the commitment");
}

// 6. The seed binds the action to its deployment. Changing the actionId alone must change
//    the seed — that binding is what stops a committed batch being replayed against a
//    different action, token, asset, or chain.
{
  const base = {
    chainId: BigInt(publicClient.chain!.id), cam: CONTRACTS.cam,
    token: action.token, asset: action.asset, recordBlock: action.recordBlock,
  };
  assert.notEqual(
    commitmentSeed({ ...base, actionId: 1n }),
    commitmentSeed({ ...base, actionId: 0n }),
  );
  assert.notEqual(
    commitmentSeed({ ...base, actionId: 0n, asset: CONTRACTS.tlnb }),
    commitmentSeed({ ...base, actionId: 0n }),
  );
  ok("the seed binds actionId and asset — a batch cannot be replayed elsewhere");
}

console.log(`\n${passed} passed`);
