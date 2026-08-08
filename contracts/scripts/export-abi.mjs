// Phase 4 — one source of truth for ABIs + deployed addresses. Copies typed ABIs straight from
// forge's build artifacts (never hand-copied) into backend/ and frontend/, plus an
// addresses.json recording where each contract actually lives on Monad testnet.
//
// Usage: node export-abi.mjs <vaultAddress> <camAddress>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const [vaultAddress, camAddress] = process.argv.slice(2);
if (!vaultAddress || !camAddress) {
  console.log("Usage: node export-abi.mjs <vaultAddress> <camAddress>");
  process.exit(1);
}

function loadAbi(name) {
  const p = path.join(ROOT, `contracts/out/${name}.sol/${name}.json`);
  return JSON.parse(readFileSync(p, "utf8")).abi;
}

const escrowVaultAbi = loadAbi("EscrowVault");
const camAbi = loadAbi("CorporateActionManager");

const addresses = {
  chainId: 10143,
  chain: "monad-testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  EscrowVault: vaultAddress,
  CorporateActionManager: camAddress,
  aUSDC: "0xaC0893567D43C3E7e6e35a72803df05416C1f20D",
  deployedAt: new Date().toISOString(),
};

for (const dest of ["backend/src/generated", "frontend/lib/generated"]) {
  const dir = path.join(ROOT, dest);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "EscrowVault.abi.json"), JSON.stringify(escrowVaultAbi, null, 2));
  writeFileSync(path.join(dir, "CorporateActionManager.abi.json"), JSON.stringify(camAbi, null, 2));
  writeFileSync(path.join(dir, "addresses.json"), JSON.stringify(addresses, null, 2));
  console.log(`Wrote ABIs + addresses.json to ${dest}/`);
}

// Also feed live-smoke.mjs's expected env file, so it can pick up the real deployment.
const deployEnvPath = path.join(ROOT, "contracts/scripts/.deploy-addresses.env");
writeFileSync(
  deployEnvPath,
  `# Written by export-abi.mjs — Phase 4 deploy output, NOT a secret (addresses only)\nVAULT_ADDRESS=${vaultAddress}\nCAM_ADDRESS=${camAddress}\n`,
);
console.log(`Wrote ${deployEnvPath}`);
