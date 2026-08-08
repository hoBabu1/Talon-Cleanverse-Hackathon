// Phase 0 custody spike runner — smartContractPhase.md §0.2 test matrix (a0..k).
// Node/viem + the Cleanverse AES call pattern from talon/freeze_test.mjs.
//
// Usage: node spike-runner.mjs <step>
//   steps: apasses | deploy | register | a0 | a | b | c | d1 | d2 | e | f | g | h | i | j | k
//
// Deliberately step-at-a-time (not "run everything"): several steps cost real MON gas or
// the once-a-day Cleanverse /faucet call, and results from one step (e.g. deploy) feed the
// next. Every step prints raw JSON — copy the output into /learning.md verbatim, per the plan.
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getContract,
  hexToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decodeViemRevertError } from "../../scripts/lib/decodeRevert.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

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
const spikeEnv = loadEnvFile(path.join(__dirname, ".spike-wallets.env"));

const API_ID = talonEnv.CLEANVERSE_SANDBOX_API_ID;
const KEY = Buffer.from(talonEnv.CLEANVERSE_SANDBOX_API_KEY, "base64");
const IV = Buffer.alloc(16, 0);
const BASE = "https://uatapi.cleanverse.com/api/cooperate";
const ATOKEN = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D"; // aUSDC on Monad, confirmed in CLAUDE.md
const RPC = "https://testnet-rpc.monad.xyz";
const CHAIN = { id: 10143, name: "monad-testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };

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

// --- on-chain plumbing ---
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });

function accountFor(role) {
  const pk = spikeEnv[`${role}_PRIVATE_KEY`];
  if (!pk) throw new Error(`missing ${role}_PRIVATE_KEY in .spike-wallets.env`);
  return privateKeyToAccount(pk);
}
function walletFor(role) {
  return createWalletClient({ account: accountFor(role), chain: CHAIN, transport: http(RPC) });
}

const ATOKEN_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

function spikeVaultArtifact() {
  const p = path.join(ROOT, "contracts/out/SpikeVault.sol/SpikeVault.json");
  return JSON.parse(readFileSync(p, "utf8"));
}

let spikeVaultAddress = spikeEnv.SPIKE_VAULT_ADDRESS; // filled after `deploy` step (see note below)

// Shared decoder (contracts/scripts/lib/decodeRevert.mjs) — this file was the original,
// correct implementation; it now imports from the extracted shared module instead of keeping
// its own copy, after a second, subtly-different copy in live-smoke.mjs broke the same way a
// naive rewrite always risks. See /learning.md, Phase 4 entry.
function describeRevert(err) {
  const { shortMessage, selector, offender, raw } = decodeViemRevertError(err);
  return { shortMessage, selector, addressArg: offender, raw };
}

async function sendTx(client, { address, abi, functionName, args }) {
  const { request } = await publicClient.simulateContract({
    account: client.account,
    address,
    abi,
    functionName,
    args,
  });
  const hash = await client.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}

const steps = {
  // Registers an A-Pass for DEPLOYER (issuer role) — needed before faucet/transfers so the
  // sender side of any compliance check has something to check, and required for step k.
  async deployerApass() {
    const D = accountFor("DEPLOYER").address;
    const farExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await cleanverseCall("generate_apass DEPLOYER(issuer)", "/generate_apass", {
      customerId: "TALONSPIKEISSUER00",
      expirationTime: farExpiry,
      wallet: { address: D, chain: "monad" },
    });
    await cleanverseCall("verify_apass DEPLOYER", "/verify_apass", { chain: "monad", atoken: ATOKEN, address: D }, { encrypted: false });
  },

  // ONE call — rate-limited to once/24h per the docs ("faucet request too frequent"). Requests
  // enough aUSDC to DEPLOYER to cover the whole a0..k matrix in a single shot.
  async faucet() {
    const D = accountFor("DEPLOYER").address;
    await cleanverseCall("faucet aUSDC -> DEPLOYER", "/faucet", {
      chain: "monad",
      symbol: "ausdc",
      depositAddress: D,
      amount: "100",
    }, { encrypted: false });
  },

  // Registers A-Passes for HOLDER1 (stays active) and HOLDER2 (will be frozen in step c/f/k).
  async apasses() {
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const H2 = accountFor("HOLDER2_FREEZABLE").address;
    const farExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await cleanverseCall("generate_apass HOLDER1", "/generate_apass", {
      customerId: "TALONSPIKE001AAA",
      expirationTime: farExpiry,
      wallet: { address: H1, chain: "monad" },
    });
    await cleanverseCall("generate_apass HOLDER2", "/generate_apass", {
      customerId: "TALONSPIKE002BBB",
      expirationTime: farExpiry,
      wallet: { address: H2, chain: "monad" },
    });
    await cleanverseCall("verify_apass HOLDER1", "/verify_apass", { chain: "monad", atoken: ATOKEN, address: H1 }, { encrypted: false });
    await cleanverseCall("verify_apass HOLDER2", "/verify_apass", { chain: "monad", atoken: ATOKEN, address: H2 }, { encrypted: false });
  },

  // Deploys SpikeVault, owner = DEPLOYER. Print the address — paste it into
  // .spike-wallets.env as SPIKE_VAULT_ADDRESS=0x... before running later steps.
  async deploy() {
    const { abi, bytecode } = spikeVaultArtifact();
    const deployer = walletFor("DEPLOYER");
    const hash = await deployer.deployContract({ abi, bytecode: bytecode.object, args: [deployer.account.address] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("\n=== [Deploy] SpikeVault ===");
    console.log(JSON.stringify({ hash, status: receipt.status, contractAddress: receipt.contractAddress }, null, 2));
    console.log(`\n>>> Paste this into .spike-wallets.env: SPIKE_VAULT_ADDRESS=${receipt.contractAddress}`);
  },

  // /validator/register — EIP-191 personal_sign over lowercase `chain+contract_address`,
  // signed by the DEPLOYER (must equal SpikeVault's Ownable owner()). Then poll is_register.
  async register() {
    if (!spikeVaultAddress) throw new Error("run `deploy` first, set SPIKE_VAULT_ADDRESS");
    const deployer = walletFor("DEPLOYER");
    const message = `monad${spikeVaultAddress.toLowerCase()}`;
    const owner_signature = await deployer.signMessage({ message });
    await cleanverseCall("validator/register SpikeVault", "/validator/register", {
      chain: "monad",
      contract_address: spikeVaultAddress,
      rule: { allowed_group: "", allowed_sub_group: "", min_tier: 0, min_sub_tier: 0, is_black_list: false, countries: [] },
      owner_signature,
    });
    console.log("\nPolling validator/is_register ...");
    for (let i = 0; i < 20; i++) {
      const res = await cleanverseCall(`is_register poll #${i}`, "/validator/is_register", { chain: "monad", contract_address: spikeVaultAddress }, { encrypted: false });
      if (res?.data?.registered || res?.registered) {
        console.log("Registered.");
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    console.log("Not confirmed registered after ~100s — record this in learning.md.");
  },

  // a0: EOA(issuer/DEPLOYER)→contract transfer BEFORE registration.
  async a0() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const deployer = walletFor("DEPLOYER");
    try {
      const r = await sendTx(deployer, { address: ATOKEN, abi: ATOKEN_ABI, functionName: "transfer", args: [spikeVaultAddress, 1n] });
      console.log("a0 result: SUCCESS", r);
    } catch (err) {
      console.log("a0 result: REVERT", describeRevert(err));
    }
  },

  // a: same transfer AFTER registration (run `register` first).
  async a() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const deployer = walletFor("DEPLOYER");
    try {
      const r = await sendTx(deployer, { address: ATOKEN, abi: ATOKEN_ABI, functionName: "transfer", args: [spikeVaultAddress, 1n] });
      console.log("a result: SUCCESS", r);
    } catch (err) {
      console.log("a result: REVERT", describeRevert(err));
    }
  },

  // b: contract→active-EOA (HOLDER1) via SpikeVault.push, owner-only (DEPLOYER signs).
  async b() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const deployer = walletFor("DEPLOYER");
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const { abi } = spikeVaultArtifact();
    try {
      const r = await sendTx(deployer, { address: spikeVaultAddress, abi, functionName: "push", args: [ATOKEN, H1, 1n] });
      console.log("b result: SUCCESS", r);
    } catch (err) {
      console.log("b result: REVERT", describeRevert(err));
    }
  },

  // c: contract→frozen-EOA (HOLDER2). Freeze HOLDER2 first (this step does the freeze + push).
  async c() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const H2 = accountFor("HOLDER2_FREEZABLE").address;
    await cleanverseCall("update_status FREEZE HOLDER2", "/update_status", {
      status: "2",
      blacklistReason: "talon-spike-c",
      wallet: { chain: "monad", address: H2 },
    });
    console.log("Waiting 10s for freeze to propagate on-chain before attempting push (see RT2 race-condition note)...");
    await new Promise((r) => setTimeout(r, 10000));
    const deployer = walletFor("DEPLOYER");
    const { abi } = spikeVaultArtifact();
    try {
      const r = await sendTx(deployer, { address: spikeVaultAddress, abi, functionName: "push", args: [ATOKEN, H2, 1n] });
      console.log("c result: SUCCESS (unexpected — expected APassNotActive revert)", r);
    } catch (err) {
      console.log("c result: REVERT (expected)", describeRevert(err));
    }
  },

  // d1: transferFrom via SpikeVault.pull, UNREGISTERED-as-spender (run before `register`,
  // or against a second, never-registered SpikeVault deployment). Issuer (DEPLOYER) must
  // approve SpikeVault first.
  async d1() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const deployer = walletFor("DEPLOYER");
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    await sendTx(deployer, { address: ATOKEN, abi: ATOKEN_ABI, functionName: "approve", args: [spikeVaultAddress, 1000n] });
    const { abi } = spikeVaultArtifact();
    try {
      const r = await sendTx(deployer, { address: spikeVaultAddress, abi, functionName: "pull", args: [ATOKEN, deployer.account.address, 1n] });
      console.log("d1 result: SUCCESS", r);
      // then push to H1 to prove the funds are usable
    } catch (err) {
      console.log("d1 result: REVERT", describeRevert(err));
    }
  },

  // d2: same as d1 but spender (SpikeVault) IS registered — run `register` first.
  async d2() {
    return steps.d1(); // identical call; distinction is purely registration state at call time
  },

  // e: contract→contract transfer. Only needed if d1/d2 fail. Requires a SECOND SpikeVault
  // deployment (SPIKE_VAULT_2_ADDRESS) to send to — deploy manually and pass via env if needed.
  async e() {
    const target = spikeEnv.SPIKE_VAULT_2_ADDRESS;
    if (!spikeVaultAddress || !target) throw new Error("set SPIKE_VAULT_ADDRESS and SPIKE_VAULT_2_ADDRESS first");
    const deployer = walletFor("DEPLOYER");
    const { abi } = spikeVaultArtifact();
    try {
      const r = await sendTx(deployer, { address: spikeVaultAddress, abi, functionName: "push", args: [ATOKEN, target, 1n] });
      console.log("e result: SUCCESS", r);
    } catch (err) {
      console.log("e result: REVERT", describeRevert(err));
    }
  },

  // f: frozen-EOA(HOLDER2)→contract, send direction. HOLDER2 must already be frozen (run `c` first)
  // and needs a tiny balance to attempt sending (push 1 unit to it while active, or use whatever b left).
  async f() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const h2Wallet = walletFor("HOLDER2_FREEZABLE");
    try {
      const r = await sendTx(h2Wallet, { address: ATOKEN, abi: ATOKEN_ABI, functionName: "transfer", args: [spikeVaultAddress, 1n] });
      console.log("f result: SUCCESS (unexpected if sender-side is checked)", r);
    } catch (err) {
      console.log("f result: REVERT", describeRevert(err));
    }
  },

  // g: transfers while pool is paused.
  async g() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    await cleanverseCall("validator/set_paused true", "/validator/set_paused", { chain: "monad", contract_address: spikeVaultAddress, paused: true });
    const deployer = walletFor("DEPLOYER");
    try {
      const r = await sendTx(deployer, { address: ATOKEN, abi: ATOKEN_ABI, functionName: "transfer", args: [spikeVaultAddress, 1n] });
      console.log("g result: SUCCESS (unexpected while paused)", r);
    } catch (err) {
      console.log("g result: REVERT (expected)", describeRevert(err));
    }
    await cleanverseCall("validator/set_paused false (cleanup)", "/validator/set_paused", { chain: "monad", contract_address: spikeVaultAddress, paused: false });
  },

  // h: pool registered with loosest rule; active holder who fails the pool rule interacts.
  // Requires re-registering with a stricter rule than HOLDER1 satisfies — document what
  // "loosest rule" concretely means once we see the /validator/register schema options.
  async h() {
    console.log("h: manual step — see plan §0.2 row h. Re-register SpikeVault with a rule HOLDER1 fails, then re-run `a`/`b` and record the selector.");
  },

  // i: generate_apass with expirationTime ~1h out, wait, attempt transfer (real expiry, not freeze).
  async i() {
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const soon = Math.floor(Date.now() / 1000) + 3600;
    await cleanverseCall("generate_apass HOLDER1 (short expiry, OVERWRITES existing)", "/generate_apass", {
      customerId: "TALONSPIKE001AAA",
      expirationTime: soon,
      wallet: { address: H1, chain: "monad" },
    });
    console.log("Re-run this step's transfer attempt after the expiry window (~1h) to observe real-expiry revert.");
  },

  // j: generate an A-Pass for the contract address itself.
  async j() {
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const farExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    await cleanverseCall("generate_apass FOR CONTRACT", "/generate_apass", {
      customerId: "TALONSPIKECONTRACT",
      expirationTime: farExpiry,
      wallet: { address: spikeVaultAddress, chain: "monad" },
    });
  },

  // k: freeze the ISSUER's (DEPLOYER's) A-Pass, attempt transferFrom(issuer→holder).
  // DEPLOYER needs its own A-Pass first — run apasses-like generate for DEPLOYER before this.
  async k() {
    const deployer = accountFor("DEPLOYER").address;
    await cleanverseCall("update_status FREEZE DEPLOYER(issuer)", "/update_status", {
      status: "2",
      blacklistReason: "talon-spike-k",
      wallet: { chain: "monad", address: deployer },
    });
    console.log("Waiting 10s for freeze to propagate...");
    await new Promise((r) => setTimeout(r, 10000));
    if (!spikeVaultAddress) throw new Error("set SPIKE_VAULT_ADDRESS first");
    const deployerWallet = walletFor("DEPLOYER");
    const H1 = accountFor("HOLDER1_ACTIVE").address;
    const { abi } = spikeVaultArtifact();
    try {
      const r = await sendTx(deployerWallet, { address: spikeVaultAddress, abi, functionName: "pull", args: [ATOKEN, deployer, 1n] });
      console.log("k result: SUCCESS (unexpected)", r);
    } catch (err) {
      console.log("k result: REVERT (expected) — record selector + whether revert data names the offending address", describeRevert(err));
    }
    await cleanverseCall("update_status UNFREEZE DEPLOYER (cleanup)", "/update_status", { status: "1", wallet: { chain: "monad", address: deployer } });
  },
};

const stepName = process.argv[2];
if (!stepName || !steps[stepName]) {
  console.log("Usage: node spike-runner.mjs <step>");
  console.log("Steps:", Object.keys(steps).join(", "));
  process.exit(1);
}

console.log(`\n########## RUNNING STEP: ${stepName} ##########`);
if (spikeVaultAddress) console.log(`(SPIKE_VAULT_ADDRESS = ${spikeVaultAddress})`);
await steps[stepName]();
