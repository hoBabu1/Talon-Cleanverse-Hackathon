// Phase 3 live smoke test — smartContractPhase.md §3.5. NOT a forge test: freeze/unfreeze are
// AES-encrypted Cleanverse API calls unreachable from forge. This IS the demo's dress
// rehearsal — declare -> execute against real aUSDC on Monad testnet with HOLDER1 active +
// HOLDER2 frozen -> verify Paid/Escrowed on-chain -> unfreeze HOLDER2 -> release -> verify.
//
// Requires real deployed EscrowVault + CorporateActionManager (Phase 4's Deploy.s.sol output)
// — set VAULT_ADDRESS / CAM_ADDRESS below before running. Reuses the wallets generated during
// the Phase 0 spike (contracts/script/spike/.spike-wallets.env) — DEPLOYER plays issuer/owner,
// HOLDER1_ACTIVE/HOLDER2_FREEZABLE already have A-Passes registered on Monad from that spike.
//
// Usage: node live-smoke.mjs <step>
//   steps: declare | freeze-holder2 | execute | verify-escrow | unfreeze-holder2 | release | verify-final
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, encodeAbiParameters, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeViemRevertError, classifyApassSelector } from "./lib/decodeRevert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function loadEnvFile(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const talonEnv = loadEnvFile(path.join(ROOT, "talon/.env"));
const spikeEnv = loadEnvFile(path.join(ROOT, "contracts/script/spike/.spike-wallets.env"));
const deployEnv = loadEnvFile(path.join(__dirname, ".deploy-addresses.env")); // written by Phase 4 deploy

const API_ID = talonEnv.CLEANVERSE_SANDBOX_API_ID;
const KEY = Buffer.from(talonEnv.CLEANVERSE_SANDBOX_API_KEY, "base64");
const IV = Buffer.alloc(16, 0);
const BASE = "https://uatapi.cleanverse.com/api/cooperate";
const ATOKEN = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";
const RPC = "https://testnet-rpc.monad.xyz";
const CHAIN = {
  id: 10143,
  name: "monad-testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const VAULT_ADDRESS = deployEnv.VAULT_ADDRESS;
const CAM_ADDRESS = deployEnv.CAM_ADDRESS;

function encrypt(obj) {
  const c = crypto.createCipheriv(`aes-${KEY.length * 8}-cbc`, KEY, IV);
  return Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64");
}

async function cleanverseCall(name, apiPath, body, { encrypted = true } = {}) {
  const headers = { "api-id": API_ID, "X-Request-ID": crypto.randomUUID(), "Content-Type": "application/json" };
  const payload = JSON.stringify(encrypted ? { data: encrypt(body) } : body);
  const res = await fetch(`${BASE}${apiPath}`, { method: "POST", headers, body: payload });
  const json = await res.json();
  console.log(`\n=== [Cleanverse] ${name} [${res.status}] ===`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
function accountFor(role) {
  const pk = spikeEnv[`${role}_PRIVATE_KEY`];
  if (!pk) throw new Error(`missing ${role}_PRIVATE_KEY`);
  return privateKeyToAccount(pk);
}
function walletFor(role) {
  return createWalletClient({ account: accountFor(role), chain: CHAIN, transport: http(RPC) });
}

const ATOKEN_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

function loadArtifact(name) {
  const p = path.join(ROOT, `contracts/out/${name}.sol/${name}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}
const VAULT_ABI = () => loadArtifact("EscrowVault").abi;
const CAM_ABI = () => loadArtifact("CorporateActionManager").abi;

// [RT2] Mandatory freeze/unfreeze race gate: the API's 200 response is NOT proof the freeze is
// live on-chain — Cleanverse's registrar write is async. Loop an eth_call simulation of a
// 1-unit transfer to the affected address until the on-chain behavior actually flips, with a
// timeout. Without this, a "frozen" holder could still get paid on stage — the demo centerpiece
// inverted. Specifically checks the revert IS `APassNotActive` (not some unrelated failure,
// e.g. insufficient issuer balance from the shared/drained sandbox faucet — see [P0-4]) —
// misreading an unrelated revert as "confirmed frozen" would be a false positive worse than
// just timing out. Uses the shared `decodeRevert.mjs` helper — a naive rewrite of this exact
// decoding logic broke silently once already; see /learning.md, Phase 4 entry.
async function waitForOnChainFreezeState(address, expectFrozen, { timeoutMs = 120000, pollMs = 3000 } = {}) {
  const deployer = accountFor("DEPLOYER").address;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Four-way outcome, not a boolean: an unrelated revert (e.g. insufficient issuer balance
    // from the shared/drained sandbox faucet, [P0-4]) must not be misread as EITHER "confirmed
    // frozen" or "confirmed active" — only a clean success confirms active, and only an
    // APassNotActive revert confirms frozen. "expired" gets its own bucket rather than being
    // lumped into "unrelated-revert" — [P4] a holder's A-Pass expiring for real, unplanned,
    // mid-run is exactly what happened once already this session; logging it distinctly means
    // a repeat shows up as a clear diagnosis instead of a confusing eventual timeout.
    let state; // "active" | "frozen" | "expired" | "unrelated-revert"
    try {
      await publicClient.simulateContract({
        account: deployer,
        address: ATOKEN,
        abi: ATOKEN_ABI,
        functionName: "transfer",
        args: [address, 1n],
      });
      state = "active";
    } catch (err) {
      const { selector, shortMessage } = decodeViemRevertError(err);
      const cls = classifyApassSelector(selector);
      state = cls === "other" ? "unrelated-revert" : cls;
      if (state === "unrelated-revert") {
        console.log(`  poll: transfer-to-${address} reverted for an UNRELATED reason (not APassNotActive/APassExpired) — not conclusive, retrying:`, shortMessage);
      } else if (state === "expired") {
        console.log(`  poll: transfer-to-${address} is EXPIRED, not frozen — this gate only tracks freeze/unfreeze; an expiry here means the test fixture drifted, same as the Phase 4 incident.`);
      }
    }
    console.log(`  poll: transfer-to-${address} state = ${state} (want frozen=${expectFrozen})`);
    if (state === "frozen" && expectFrozen) return;
    if (state === "active" && !expectFrozen) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for on-chain freeze state (expectFrozen=${expectFrozen}) on ${address}`);
}

// [RT2] Tight explicit limits — Monad may charge gas LIMIT, not gas used, so padding "to be
// safe" costs real MON. [Bug, caught live during Phase 4] the original 500_000n placeholder
// was measured wrong — `cast estimate` on the real deployed CAM for this exact 2-holder batch
// came back at 1_117_523 (the preflight's 3 external calls plus via_ir codegen cost more than
// guessed), and the too-low limit caused a real out-of-gas revert with empty revert data on
// the first live attempt. This value IS now measured against the real deployment, not
// guessed — but still not a formal Phase 5 snapshot; re-measure before changing batch size.
const GAS = 1500000n;

const steps = {
  async declare() {
    if (!CAM_ADDRESS) throw new Error("set CAM_ADDRESS in .deploy-addresses.env (Phase 4 output)");
    const deployer = walletFor("DEPLOYER");
    const abi = CAM_ABI();
    const block = await publicClient.getBlockNumber();
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const H2 = accountFor("HOLDER2_FREEZABLE").address;
    const ASSET = ATOKEN; // this rehearsal doesn't test a distinct bond asset; aUSDC stands in for both

    // [P3] runningHash is seeded with a provenance binding at declaration, not bytes32(0) —
    // must match CorporateActionManager.declareAction's seed formula EXACTLY:
    //   keccak256(abi.encode(chainid, camAddress, actionId, token, asset, recordBlock))
    // actionId is predictable off-chain (a sequential owner-only serial) via actionsCount()
    // BEFORE this declare call — that predicted value IS the actionId the tx will receive.
    const predictedActionId = await publicClient.readContract({
      address: CAM_ADDRESS,
      abi,
      functionName: "actionsCount",
    });
    const seed = keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" }, { type: "address" }, { type: "uint256" },
          { type: "address" }, { type: "address" }, { type: "uint256" },
        ],
        [BigInt(CHAIN.id), CAM_ADDRESS, predictedActionId, ATOKEN, ASSET, block],
      ),
    );

    // Real chained-hash commitment (§2.1) over the EXACT batch `execute` will submit, seeded
    // correctly — a dummy all-zero-seeded hash would never exercise the mechanism this whole
    // script exists to rehearse, and would make `closeAction` unusable afterward
    // (CoverageHashMismatch).
    const holderSetHash = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address[]" }, { type: "uint256[]" }],
        [seed, [H1, H2], [1n, 1n]],
      ),
    );

    const { request } = await publicClient.simulateContract({
      account: deployer.account,
      address: CAM_ADDRESS,
      abi,
      functionName: "declareAction",
      args: [ATOKEN, ASSET, block, 2n, holderSetHash, 2, 0n],
      gas: GAS,
    });
    const hash = await deployer.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`declareAction tx reverted: ${hash}`);

    // Read the REAL actionId from the mined ActionDeclared event, not a pre-broadcast
    // simulation return value — the simulation result could in principle diverge from what
    // actually lands if `_nextActionId` advanced between simulate and broadcast.
    const decoded = receipt.logs
      .map((log) => {
        try {
          return decodeEventLog({ abi, data: log.data, topics: log.topics });
        } catch {
          return null;
        }
      })
      .find((e) => e?.eventName === "ActionDeclared");
    if (!decoded) throw new Error("ActionDeclared event not found in receipt");

    console.log(`\n=== declareAction ===\nactionId (from mined event) = ${decoded.args.actionId}\ntx = ${hash}`);
    console.log(`>>> Note this actionId for the remaining steps.`);
  },

  async "freeze-holder2"() {
    const H2 = accountFor("HOLDER2_FREEZABLE").address;
    await cleanverseCall("update_status FREEZE HOLDER2", "/update_status", {
      status: "2",
      blacklistReason: "talon-live-smoke",
      wallet: { chain: "monad", address: H2 },
    });
    console.log("Waiting for ON-CHAIN freeze confirmation (not just the API 200)...");
    await waitForOnChainFreezeState(H2, true);
    console.log("Confirmed frozen on-chain.");
  },

  async execute() {
    const actionId = process.argv[3];
    if (actionId === undefined) throw new Error("usage: node live-smoke.mjs execute <actionId>");
    if (!CAM_ADDRESS) throw new Error("set CAM_ADDRESS");
    const deployer = walletFor("DEPLOYER");
    const abi = CAM_ABI();
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const H2 = accountFor("HOLDER2_FREEZABLE").address;

    const { request } = await publicClient.simulateContract({
      account: deployer.account,
      address: CAM_ADDRESS,
      abi,
      functionName: "executePayoutRun",
      args: [BigInt(actionId), [H1, H2], [1n, 1n]],
      gas: GAS,
    });
    const hash = await deployer.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`executePayoutRun tx reverted: ${hash}`);
    console.log(`\n=== executePayoutRun ===\ntx = ${hash}\nstatus = ${receipt.status}`);
  },

  async "verify-escrow"() {
    const actionId = process.argv[3];
    if (!CAM_ADDRESS || !VAULT_ADDRESS) throw new Error("set CAM_ADDRESS and VAULT_ADDRESS");
    const camAbi = CAM_ABI();
    const vaultAbi = VAULT_ABI();
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const H2 = accountFor("HOLDER2_FREEZABLE").address;

    const status1 = await publicClient.readContract({ address: CAM_ADDRESS, abi: camAbi, functionName: "holderStatusOf", args: [BigInt(actionId), H1] });
    const status2 = await publicClient.readContract({ address: CAM_ADDRESS, abi: camAbi, functionName: "holderStatusOf", args: [BigInt(actionId), H2] });
    const ledger2 = await publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "ledgerOf", args: [H2, ATOKEN] });

    console.log(`HOLDER1 status (want Paid=1): ${status1}`);
    console.log(`HOLDER2 status (want Escrowed=2): ${status2}`);
    console.log(`HOLDER2 vault ledger (want 1): ${ledger2}`);
    if (status1 !== 1 || status2 !== 2 || ledger2 !== 1n) {
      throw new Error("Smoke test assertion failed at verify-escrow");
    }
    console.log("verify-escrow: PASS");
  },

  async "unfreeze-holder2"() {
    const H2 = accountFor("HOLDER2_FREEZABLE").address;
    await cleanverseCall("update_status UNFREEZE HOLDER2", "/update_status", {
      status: "1",
      wallet: { chain: "monad", address: H2 },
    });
    console.log("Waiting for ON-CHAIN unfreeze confirmation...");
    await waitForOnChainFreezeState(H2, false);
    console.log("Confirmed active on-chain.");
  },

  async release() {
    if (!VAULT_ADDRESS) throw new Error("set VAULT_ADDRESS");
    const deployer = walletFor("DEPLOYER"); // permissionless retry — anyone can trigger
    const abi = VAULT_ABI();
    const H2 = accountFor("HOLDER2_FREEZABLE").address;

    const { request } = await publicClient.simulateContract({
      account: deployer.account,
      address: VAULT_ADDRESS,
      abi,
      functionName: "release",
      args: [H2, ATOKEN],
      gas: GAS,
    });
    const hash = await deployer.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`release tx reverted: ${hash}`);
    console.log(`\n=== release ===\ntx = ${hash}\nstatus = ${receipt.status}`);
  },

  async "verify-final"() {
    const H2 = accountFor("HOLDER2_FREEZABLE").address;
    const bal = await publicClient.readContract({ address: ATOKEN, abi: ATOKEN_ABI, functionName: "balanceOf", args: [H2] });
    const ledger2 = await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI(),
      functionName: "ledgerOf",
      args: [H2, ATOKEN],
    });
    console.log(`HOLDER2 aUSDC balance: ${bal}`);
    console.log(`HOLDER2 vault ledger (want 0): ${ledger2}`);
    if (ledger2 !== 0n) throw new Error("Smoke test assertion failed at verify-final");
    console.log("verify-final: PASS — full drift-and-recovery cycle proven live on-chain.");
  },
};

const stepName = process.argv[2];
if (!stepName || !steps[stepName]) {
  console.log("Usage: node live-smoke.mjs <step> [actionId]");
  console.log("Steps:", Object.keys(steps).join(", "));
  process.exit(1);
}
console.log(`\n########## LIVE SMOKE STEP: ${stepName} ##########`);
await steps[stepName]();
