/**
 * Builds the demo cap table: generates wallets, issues each an A-Pass, and mints TLNB.
 *
 * Run:  npx tsx scripts/setup-demo-captable.ts [--execute]
 *
 * Dry-run by default. Nothing is generated, called, or minted without --execute,
 * because this both spends MON and creates real A-Pass identities in the sandbox.
 *
 * Deliberately reuses backend/src/lib/cleanverse.ts rather than re-implementing the
 * AES encryption, per the project's stated reusability principle -- that encryption
 * logic has exactly one home.
 *
 * A-Pass is enforced on RECEIPT: minting TLNB to a wallet with no A-Pass reverts with
 * NoAPass(address) = 0xa6725971 (confirmed live on both TLNB and aUSDC). So every
 * holder must be issued an A-Pass BEFORE any mint, and the script verifies each one
 * before touching the chain.
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { createWalletClient, http, parseAbiItem, formatEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { publicClient, monadTestnet } from "../src/lib/chain.js";
import { cleanverse } from "../src/lib/cleanverse.js";
import { awaitApassUsable } from "../src/lib/eligibility.js";
import { formatWriteProgress } from "../src/lib/awaitCleanverseWrite.js";

const EXECUTE = process.argv.includes("--execute");
const ROOT = path.resolve(import.meta.dirname, "../..");
const KEYFILE = path.join(ROOT, "contracts/script/spike/.demo-wallets.env");
const TLNB = "0xbAE642890988C3EF56e77Fb041aFD847A6131d64" as const;

/**
 * The demo register. Balances are chosen so the coupon maths produces a genuinely
 * interesting cap table rather than a uniform one:
 *
 *   total supply         64,505 TLNB units
 *   coupon budget         9,000 raw aUSDC units (issuer holds 9,993 -- headroom is deliberate)
 *   entitlement           floor(balance * 9000 / 64505)
 *
 * DUST is 5 units on purpose: its entitlement floors to ZERO. Zero-amount holders must
 * be dropped before hashing (ZeroAmount() reverts the whole batch), which gives the UI a
 * real "1 holder excluded: entitlement rounds to zero" case to display. That is honest
 * transfer-agent behaviour and worth showing rather than hiding.
 */
const NEW_HOLDERS = [
  { label: "PENSION", tlnb: 20000n },
  { label: "FUND_A", tlnb: 15000n },
  { label: "FUND_B", tlnb: 12000n },
  { label: "TREASURY", tlnb: 8000n },
  { label: "RETAIL", tlnb: 1500n },
  { label: "DUST", tlnb: 5n },
] as const;

// Already minted in a previous step; listed so the projection below is the whole register.
const EXISTING = [
  { label: "HOLDER1_ACTIVE", address: "0x924c33f763860e433fdc02A0158d2916e66b7410", tlnb: 5000n },
  { label: "HOLDER2_FREEZABLE", address: "0x71b0C66ec7076bb27Cd4280b0AD0b1b88F7873c6", tlnb: 3000n },
];

const COUPON_BUDGET = 9000n;

function readEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const spike = readEnvFile(path.join(ROOT, "contracts/script/spike/.spike-wallets.env"));
const deployerKey = spike.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY missing from .spike-wallets.env");
const deployer = privateKeyToAccount(deployerKey);

// Reuse wallets across reruns so this script is idempotent and doesn't leak identities.
const existingKeys = readEnvFile(KEYFILE);

const wallets = NEW_HOLDERS.map((h) => {
  const envKey = `${h.label}_PRIVATE_KEY`;
  const pk = (existingKeys[envKey] as `0x${string}`) ?? generatePrivateKey();
  return { ...h, privateKey: pk, address: privateKeyToAccount(pk).address, reused: Boolean(existingKeys[envKey]) };
});

// ---- Projection (always printed, even in dry-run) --------------------------------

const register = [
  ...EXISTING.map((h) => ({ label: h.label, address: h.address, tlnb: h.tlnb })),
  ...wallets.map((w) => ({ label: w.label, address: w.address, tlnb: w.tlnb })),
];
const totalSupply = register.reduce((a, h) => a + h.tlnb, 0n);

console.log(`\nProjected register (total supply ${totalSupply} TLNB units, coupon ${COUPON_BUDGET} raw aUSDC):\n`);
let entitledTotal = 0n;
let excluded = 0;
for (const h of register) {
  const ent = (h.tlnb * COUPON_BUDGET) / totalSupply; // integer division == floor
  if (ent === 0n) excluded++;
  entitledTotal += ent;
  console.log(
    `  ${h.label.padEnd(18)} ${h.address}  ${String(h.tlnb).padStart(6)} TLNB  -> ${String(ent).padStart(5)} aUSDC${ent === 0n ? "   <- rounds to zero, excluded before hashing" : ""}`,
  );
}
console.log(`\n  entitlements total ${entitledTotal} / budget ${COUPON_BUDGET}; ${excluded} holder(s) excluded`);

if (entitledTotal > 9993n) {
  console.error(`\nABORT: entitlements (${entitledTotal}) exceed the issuer's entire aUSDC balance (9993).`);
  process.exit(1);
}

if (!EXECUTE) {
  console.log("\nDry run. Re-run with --execute to generate A-Passes and mint.\n");
  process.exit(0);
}

// ---- Execute ---------------------------------------------------------------------

// Persist keys BEFORE any on-chain spend, so a crash mid-run can never strand funds in
// a wallet whose key was never written down.
const keyfileBody =
  "# Generated demo cap-table wallets. Gitignored (*-wallets.env), 600 perms.\n" +
  "# Testnet demo identities only -- never reuse these anywhere real.\n" +
  wallets.map((w) => `${w.label}_PRIVATE_KEY=${w.privateKey}\n${w.label}_ADDRESS=${w.address}`).join("\n") +
  "\n";
writeFileSync(KEYFILE, keyfileBody, { mode: 0o600 });
chmodSync(KEYFILE, 0o600);
console.log(`\nwrote ${KEYFILE} (600)`);

const FAR_EXPIRY = Math.floor(Date.now() / 1000) + 365 * 24 * 3600 * 5; // +5 years

for (const w of wallets) {
  console.log(`\n--- ${w.label} ${w.address}${w.reused ? " (reused key)" : ""} ---`);

  const existing = await cleanverse.queryApass("monad", w.address);
  const hasApass = existing.code === "0000" && existing.data && typeof existing.data === "object";

  if (hasApass) {
    console.log("  A-Pass already exists, skipping generate");
  } else {
    const gen = await cleanverse.generateApass({
      // Alphanumeric only. Cleanverse rejected "TALONDEMOFUND_A" (15 chars) with
      // "customer id must be at least 12 characters long" while accepting
      // "TALONDEMOPENSION" -- it evidently strips non-alphanumerics before checking
      // length, so the underscore silently cost 1 char and produced a misleading error.
      customerId: `TALONDEMO${w.label.replace(/[^A-Z0-9]/g, "")}`.padEnd(12, "0").slice(0, 20),
      expirationTime: FAR_EXPIRY,
      wallet: { address: w.address, chain: "monad" },
    });
    if (gen.code !== "0000") {
      console.error(`  generate_apass FAILED: ${gen.code} ${gen.message ?? ""}`);
      process.exit(1);
    }
    console.log("  A-Pass generated");
  }

  // A 200 from generate_apass is NOT proof the A-Pass is live on-chain: observed
  // returning code 2 ("no A-Pass") for several seconds after a successful generate. Same
  // race as freeze/unfreeze and as /atoken/launch -- the API acknowledges, the chain
  // catches up afterwards. Every such wait goes through the ONE shared helper; see
  // src/lib/awaitCleanverseWrite.ts for why there are deliberately no variants of it.
  //
  // The probe runs against aUSDC rather than TLNB because it simulates a transfer FROM
  // the issuer, and the issuer holds aUSDC but zero TLNB (it mints TLNB rather than
  // holding it). A TLNB probe would revert on insufficient balance and read as
  // permanently inconclusive. An A-Pass is a wallet-level credential, so confirming it
  // on one A-Token confirms the credential itself -- which is what gates the mint.
  try {
    await awaitApassUsable(w.address, {
      onProgress: (p) => process.stdout.write(`  ${formatWriteProgress(p)}\r`),
    });
    process.stdout.write("\n");
  } catch (err) {
    console.error(`\n  ${(err as Error).message}`);
    console.error("  Not minting to this wallet.");
    process.exit(1);
  }
}

// ---- Mint ------------------------------------------------------------------------

const walletClient = createWalletClient({ account: deployer, chain: monadTestnet, transport: http() });
const mintAbi = [parseAbiItem("function mint(address to, uint256 amount)")] as const;

const balBefore = await publicClient.getBalance({ address: deployer.address });
console.log(`\nissuer MON before: ${formatEther(balBefore)}`);

for (const w of wallets) {
  const current = await publicClient.readContract({
    address: TLNB,
    abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")],
    functionName: "balanceOf",
    args: [w.address],
  });
  if (current >= w.tlnb) {
    console.log(`  ${w.label}: already holds ${current}, skipping mint`);
    continue;
  }
  const amount = w.tlnb - current;

  // Explicit gas from a real estimate x1.3. Monad charges the gas LIMIT rather than gas
  // used, so a hardcoded constant is either an overpay or a silent out-of-gas -- the
  // latter has already bitten this project once.
  const est = await publicClient.estimateContractGas({
    address: TLNB, abi: mintAbi, functionName: "mint", args: [w.address, amount], account: deployer,
  });
  const hash = await walletClient.writeContract({
    address: TLNB, abi: mintAbi, functionName: "mint", args: [w.address, amount], gas: (est * 13n) / 10n,
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") {
    console.error(`  ${w.label}: MINT REVERTED (${hash})`);
    process.exit(1);
  }
  console.log(`  ${w.label}: minted ${amount} TLNB  gas ${rcpt.gasUsed}  ${hash}`);
}

const balAfter = await publicClient.getBalance({ address: deployer.address });
console.log(`\nissuer MON after: ${formatEther(balAfter)}  (spent ${formatEther(balBefore - balAfter)})`);

const supply = await publicClient.readContract({
  address: TLNB, abi: [parseAbiItem("function totalSupply() view returns (uint256)")], functionName: "totalSupply",
});
console.log(`TLNB totalSupply now: ${supply} (expected ${totalSupply})`);
console.log(supply === totalSupply ? "\nCap table complete.\n" : "\nWARNING: supply does not match the projection.\n");
