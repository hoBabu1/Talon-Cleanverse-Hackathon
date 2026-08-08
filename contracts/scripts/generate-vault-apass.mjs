// Phase 4 — [P0-1] the vault's own A-Pass is what enables custody, NOT Validator pool
// registration (spike-proven, see /learning.md). One synchronous /generate_apass call, no
// owner signature, no async poll. Run once per vault deployment (redeploys are cheap now).
//
// Usage: node generate-vault-apass.mjs <vaultAddress>
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const env = {};
for (const line of readFileSync(path.join(ROOT, "talon/.env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const API_ID = env.CLEANVERSE_SANDBOX_API_ID;
const KEY = Buffer.from(env.CLEANVERSE_SANDBOX_API_KEY, "base64");
const IV = Buffer.alloc(16, 0);
const BASE = "https://uatapi.cleanverse.com/api/cooperate";
const ATOKEN = "0xaC0893567D43C3E7e6e35a72803df05416C1f20D";

function encrypt(obj) {
  const c = crypto.createCipheriv(`aes-${KEY.length * 8}-cbc`, KEY, IV);
  return Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64");
}

async function call(name, apiPath, body, { encrypted = true } = {}) {
  const headers = { "api-id": API_ID, "X-Request-ID": crypto.randomUUID(), "Content-Type": "application/json" };
  const payload = JSON.stringify(encrypted ? { data: encrypt(body) } : body);
  const res = await fetch(`${BASE}${apiPath}`, { method: "POST", headers, body: payload });
  const json = await res.json();
  console.log(`\n=== ${name} [${res.status}] ===`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

const vaultAddress = process.argv[2];
if (!vaultAddress) {
  console.log("Usage: node generate-vault-apass.mjs <vaultAddress>");
  process.exit(1);
}

// [P0-1] Far-future expiry — mandatory. If the vault's own A-Pass lapses, escrow deposits AND
// every beneficiary's claim/release break at once, through no fault of theirs.
const farExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600 * 5; // +5 years
await call("generate_apass FOR VAULT", "/generate_apass", {
  customerId: "TALONVAULT00000001",
  expirationTime: farExpiry,
  wallet: { address: vaultAddress, chain: "monad" },
});

const verify = await call(
  "verify_apass VAULT",
  "/verify_apass",
  { chain: "monad", atoken: ATOKEN, address: vaultAddress },
  { encrypted: false },
);

const code = verify?.data?.code;
console.log(`\nvault verify_apass code = ${code} (want 4 = success)`);
if (code !== 4) {
  console.error("FAILED: vault A-Pass did not verify as active. Do not proceed to live-smoke.");
  process.exit(1);
}
console.log("Vault A-Pass confirmed active. Safe to proceed.");
