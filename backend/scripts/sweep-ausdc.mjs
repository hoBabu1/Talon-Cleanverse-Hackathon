#!/usr/bin/env node
/**
 * sweep-ausdc.mjs — pull every holder wallet's aUSDC back to the owner/issuer,
 * so the demo issuer has a full balance to distribute again.
 *
 * DRY RUN by default (reports balances, moves nothing).
 *   node scripts/sweep-ausdc.mjs            # report only
 *   node scripts/sweep-ausdc.mjs --execute  # actually transfer
 *
 * Notes:
 *  - aUSDC is a Cleanverse A-Token: a transfer reverts unless BOTH sender and
 *    recipient (the owner) have an active A-Pass. A frozen/expired holder will
 *    revert — the script reports that per-wallet and moves on, it does not fail.
 *  - Holders need MON for gas (Monad bills the gas LIMIT). If a holder has aUSDC
 *    but too little MON, the owner tops it up first from its own balance.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, createWalletClient, http, defineChain,
  formatUnits, formatEther, parseEther, getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EXECUTE = process.argv.includes("--execute");

const RPC = "https://testnet-rpc.monad.xyz";
const AUSDC = getAddress("0xaC0893567D43C3E7e6e35a72803df05416C1f20D");
const OWNER = getAddress("0xfb94354aBd303d6423d285ECD7315F7a45A5ba23");

const monad = defineChain({
  id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amt", type: "uint256" }], outputs: [{ type: "bool" }] },
];

function readEnv(p) {
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const demo = readEnv(path.join(ROOT, "contracts/script/spike/.demo-wallets.env"));
const spike = readEnv(path.join(ROOT, "contracts/script/spike/.spike-wallets.env"));
const ownerKey = spike.DEPLOYER_PRIVATE_KEY;
if (!ownerKey) throw new Error("DEPLOYER_PRIVATE_KEY missing");

// Every *_PRIVATE_KEY that is NOT the deployer becomes a holder to sweep.
const all = { ...demo, ...spike };
const holders = Object.keys(all)
  .filter((k) => k.endsWith("_PRIVATE_KEY") && k !== "DEPLOYER_PRIVATE_KEY")
  .map((k) => {
    const label = k.replace(/_PRIVATE_KEY$/, "");
    const account = privateKeyToAccount(all[k]);
    return { label, account, pk: all[k] };
  });

const pub = createPublicClient({ chain: monad, transport: http(RPC) });

// Enough MON to cover a ~120k-gas transfer at Monad's gas-limit billing, with margin.
// A single aUSDC transfer runs the full A-Pass verification path — measured
// at ~0.04 MON of gas-limit billing. Top up generously so it can't run short.
const MIN_GAS = parseEther("0.05");
const TOPUP = parseEther("0.06");

async function main() {
  const dec = await pub.readContract({ address: AUSDC, abi: ERC20, functionName: "decimals" });
  console.log(`\naUSDC ${AUSDC}  (decimals ${dec})`);
  console.log(`Owner ${OWNER}`);
  console.log(EXECUTE ? "\n=== EXECUTE — moving funds ===\n" : "\n=== DRY RUN — nothing will move (pass --execute to send) ===\n");

  const ownerBefore = await pub.readContract({ address: AUSDC, abi: ERC20, functionName: "balanceOf", args: [OWNER] });
  console.log(`Owner aUSDC before: ${formatUnits(ownerBefore, dec)}\n`);

  const ownerWallet = createWalletClient({ account: privateKeyToAccount(ownerKey), chain: monad, transport: http(RPC) });

  let swept = 0n;
  for (const h of holders) {
    const addr = h.account.address;
    const [bal, mon] = await Promise.all([
      pub.readContract({ address: AUSDC, abi: ERC20, functionName: "balanceOf", args: [addr] }),
      pub.getBalance({ address: addr }),
    ]);
    const line = `${h.label.padEnd(18)} ${addr}  aUSDC ${formatUnits(bal, dec).padStart(12)}  MON ${formatEther(mon).slice(0, 8)}`;
    if (bal === 0n) { console.log(`${line}  — skip (empty)`); continue; }
    if (!EXECUTE) { console.log(`${line}  → would sweep ${formatUnits(bal, dec)}`); continue; }

    console.log(line);
    try {
      // Top up gas if the holder can't afford the transfer.
      if (mon < MIN_GAS) {
        console.log(`  · funding gas (${formatEther(TOPUP)} MON)…`);
        const fh = await ownerWallet.sendTransaction({ to: addr, value: TOPUP });
        await pub.waitForTransactionReceipt({ hash: fh });
      }
      const holderWallet = createWalletClient({ account: h.account, chain: monad, transport: http(RPC) });
      // Let viem auto-estimate — a real transfer runs ~302k; an explicit limit
      // only risks under-budgeting the A-Pass path.
      const hash = await holderWallet.writeContract({
        address: AUSDC, abi: ERC20, functionName: "transfer", args: [OWNER, bal],
      });
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      if (rcpt.status === "success") {
        console.log(`  ✓ swept ${formatUnits(bal, dec)} aUSDC  (${hash})`);
        swept += bal;
      } else {
        console.log(`  ✗ reverted on-chain (likely not eligible / frozen)  (${hash})`);
      }
    } catch (err) {
      console.log(`  ✗ ${String(err.shortMessage ?? err.message).split("\n")[0]}`);
    }
  }

  const ownerAfter = await pub.readContract({ address: AUSDC, abi: ERC20, functionName: "balanceOf", args: [OWNER] });
  console.log(`\nTotal swept: ${formatUnits(swept, dec)} aUSDC`);
  console.log(`Owner aUSDC after: ${formatUnits(ownerAfter, dec)}`);
  if (!EXECUTE) console.log("\n(Re-run with --execute to actually move the funds.)");
}

main().catch((e) => { console.error(e); process.exit(1); });
