import crypto from "node:crypto";
import { env } from "./env.js";

/**
 * Cleanverse Cooperate API client (v5.6).
 *
 * Encryption scheme confirmed working against the real sandbox on 2026-07-30
 * (see /learning.md): AES-256-CBC, a fixed all-zero 16-byte IV, key = base64-decoded
 * api-key. Some endpoints require the JSON body wrapped as {"data": "<b64 ciphertext>"};
 * others (reads) take plain JSON. Each method below is explicit about which it is —
 * don't guess per-endpoint, the docs are authoritative (see talon/docs/cleanverse_api_v5.6_raw.txt).
 */

const KEY = Buffer.from(env.CLEANVERSE_SANDBOX_API_KEY, "base64");
const IV = Buffer.alloc(16, 0);

function encrypt(payload: unknown): string {
  const cipher = crypto.createCipheriv(`aes-${KEY.length * 8}-cbc`, KEY, IV);
  return Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("base64");
}

function decrypt(b64: string): unknown {
  try {
    const decipher = crypto.createDecipheriv(`aes-${KEY.length * 8}-cbc`, KEY, IV);
    const decrypted = Buffer.concat([decipher.update(Buffer.from(b64, "base64")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return null;
  }
}

export type CleanverseResponse<T> = {
  code: string;
  message: string;
  data: T | null;
};

async function request<T>(
  path: string,
  body: Record<string, unknown> | undefined,
  opts: { method?: "GET" | "POST"; encrypted?: boolean } = {}
): Promise<CleanverseResponse<T>> {
  const { method = "POST", encrypted = false } = opts;
  const headers: Record<string, string> = {
    "api-id": env.CLEANVERSE_SANDBOX_API_ID,
    "X-Request-ID": crypto.randomUUID(),
  };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(encrypted ? { data: encrypt(body) } : body);
  }

  const res = await fetch(`${env.CLEANVERSE_BASE_URL}${path}`, { method, headers, body: payload });
  const json = (await res.json()) as CleanverseResponse<T>;

  // Some endpoints return ciphertext in `data` even on plain-JSON requests — try to decrypt,
  // fall through to raw value if it wasn't actually encrypted.
  if (typeof json.data === "string" && (json.data as string).length > 40) {
    const dec = decrypt(json.data as unknown as string);
    if (dec) (json as { data: unknown }).data = dec;
  }
  return json;
}

// --- Types (trimmed to fields Talon actually uses; full schema in talon/docs) ---

export type Chain =
  | "solana" | "base" | "avalanche" | "arbitrum" | "ethereum"
  | "polygon" | "bsc" | "monad" | "hashkey" | "platon";

export interface AApassRecord {
  cvRecordId: string | null;
  status: 1 | 2; // 1 = Active, 2 = Frozen
  expirationTime: number; // unix seconds
  tier: string;
  subTier: number;
  group: string;
  subGroup: string;
  countries: string[];
  currentKycHash: string;
}

export interface AtokenRule {
  allowed_group: string;
  allowed_sub_group: string;
  min_tier: number;
  min_sub_tier: number;
  is_black_list?: boolean;
  countries?: string[];
}

export interface VerifyApassResult {
  chain: Chain;
  atoken: string;
  address: string;
  code: 1 | 2 | 3 | 4; // 1=no token 2=no apass 3=expired/frozen 4=success
  message: string;
  magickLink?: string;
}

// --- Client ---

/**
 * Result of an A-Pass lookup, as a discriminated union.
 *
 * This exists because of a genuinely dangerous response shape. For a wallet with NO
 * A-Pass, query_apass returns `{"code":"0002","data":""}` — `data` is an EMPTY STRING,
 * not null and not an object (confirmed live). Read `data.status` off that and you get
 * `undefined`; every boolean check against it then reads false, and a wallet with no
 * credential at all renders as ACTIVE — the single most misleading thing this dashboard
 * could possibly display.
 *
 * Keying on `code === "0000"` and forcing callers through `found` makes that outcome
 * unrepresentable rather than merely unlikely.
 */
export type ApassLookup =
  | { found: true; record: AApassRecord }
  | { found: false; code: string; message?: string };

export const cleanverse = {
  /** Read current A-Pass state for a wallet. Plain JSON, any role. */
  queryApass(chain: Chain, address: string) {
    return request<AApassRecord>("/query_apass", { chain, address }, { encrypted: false });
  },

  /**
   * `queryApass` with the empty-string case made explicit. Prefer this everywhere; the
   * raw method is kept only for callers that need the untouched envelope.
   */
  async queryApassRecord(chain: Chain, address: string): Promise<ApassLookup> {
    const res = await cleanverse.queryApass(chain, address);
    const data = res.data as unknown;
    if (res.code === "0000" && data && typeof data === "object") {
      return { found: true, record: data as AApassRecord };
    }
    return { found: false, code: res.code, message: res.message };
  },

  /**
   * Ask Cleanverse's own on-chain check whether `address` can currently
   * send/receive `atoken`. On failure this reflects a REAL contract revert
   * (confirmed: `APassNotActive`), not just an app-level flag — see learning.md.
   */
  verifyApass(chain: Chain, atoken: string, address: string) {
    return request<VerifyApassResult>("/verify_apass", { chain, atoken, address }, { encrypted: false });
  },

  /** Issue Member only. Creates a new A-Pass identity for a wallet. Encrypted body. */
  generateApass(input: {
    customerId: string;
    expirationTime: number;
    wallet: { address: string; chain: Chain };
    subTier?: number;
    subGroup?: string;
  }) {
    return request<{ cvRecordId: string; tier: string }>("/generate_apass", input, { encrypted: true });
  },

  /** Issue Member only. Freeze (2) or unfreeze (1) an A-Pass. Encrypted body. */
  updateStatus(input: {
    status: "1" | "2";
    wallet: { address: string; chain: Chain };
    blacklistReason?: string;
    customerId?: string;
  }) {
    return request<{ txHash: string }>("/update_status", input, { encrypted: true });
  },

  /** Per-transaction Travel Rule / Transaction report. Returns a time-limited download URL. */
  downloadTravelRule(input: { txHash: string; wallet: { address: string; chain: Chain }; customerId?: string }) {
    return request<{ downloadUrl: string; fileName: string }>("/download_travel_rule", input, { encrypted: false });
  },

  /** Which A-Tokens exist on a chain (address, decimals, etc). Plain JSON. */
  queryDepositAtokenList(chain: Chain) {
    return request<{ chain: Chain; tokens: unknown[] }>("/query_deposit_atoken_list", { chain }, { encrypted: false });
  },

  /** Whether a contract address is registered as a Validator compliance pool. Plain JSON. */
  validatorIsRegister(chain: Chain, contract_address: string) {
    return request<{ chain: Chain; registered: boolean; contract_address: string }>(
      "/validator/is_register", { chain, contract_address }, { encrypted: false }
    );
  },

  /** Query all compliance rules configured for an A-Token. Plain JSON, any role. */
  atokenRules(chain: Chain, atoken_address: string) {
    return request<{ chain: Chain; atoken_address: string; rules: AtokenRule[] }>(
      "/atoken/rules", { chain, atoken_address }, { encrypted: false }
    );
  },

  /**
   * Issue Member only. Submits an A-Token launch application — async, returns a requestId.
   * Poll `atokenQueryApplyStatus` for the terminal outcome (ISSUED is the only success state).
   * Encrypted body.
   */
  atokenLaunch(input: {
    chain: Chain;
    token_name: string;
    token_symbol: string;
    decimals: number;
    admin_address: string;
    rule: AtokenRule;
    icon: string;
    callback_url?: string;
  }) {
    return request<{ requestId: string }>("/atoken/launch", input, { encrypted: true });
  },

  /**
   * Poll the async result of an /atoken/launch (or register/wrapped) application. GET, path
   * param, UNENCRYPTED — this endpoint's shape doesn't match the POST-body pattern the other
   * methods use, so it's the one place `request()` is called with `method: "GET"` and no body.
   */
  atokenQueryApplyStatus(requestId: string) {
    return request<{
      flowType: string;
      requestId: string;
      applyStatus: "PENDING" | "APPROVED" | "ISSUING" | "ISSUED" | "REJECTED" | "ISSUE_FAILED";
      rejectReason?: string;
      issueErrorMsg?: string;
      chain: Chain;
      atokenAddress?: string;
      tokenSymbol?: string;
      txHash?: string;
      issuedAt?: string;
    }>(`/atoken/query_apply_status/${requestId}`, undefined, { method: "GET" });
  },
};
