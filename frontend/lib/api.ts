/**
 * The one place the frontend talks to the backend. Everything goes through
 * `apiFetch` so error handling is uniform.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, `Cannot reach the Talon API at ${API_BASE}. Is the backend running?`);
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
    } catch {
      // Non-JSON error body; the status line is the best we have.
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

// --- Shapes returned by the backend -----------------------------------------------

export type DisplayState = "active" | "frozen" | "expired" | "no_apass" | "unknown";

export interface Holder {
  wallet: string;
  balance: string;
  displayState: DisplayState;
  hasApass: boolean | null;
  isFrozen: boolean | null;
  isExpired: boolean | null;
  expirationTime: number | null;
  verifyCode: number | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  stale: boolean;
}

export interface Reconciliation {
  ok: boolean;
  totalSupply: string;
  indexedSum: string;
  shortfall: string;
  holderCount: number;
  cursorLagBlocks: string;
  headBlock: string;
  problem?: string;
}

export interface HoldersResponse {
  asset: string;
  holders: Holder[];
  reconciliation: Reconciliation;
  anyStale: boolean;
}

export interface VaultHealth {
  vault: string;
  eligibility: string;
  apassStatus: number | null;
  expiresAt: number | null;
  daysLeft: number | null;
  aUSDCHeld: string;
  healthy: boolean;
}

export function getHolders() {
  return apiFetch<HoldersResponse>("/holders");
}

export function getVaultHealth() {
  return apiFetch<VaultHealth>("/vault-health");
}

// --- Corporate actions -------------------------------------------------------------

export type ActionStatus = "Prepared" | "Declared" | "Executing" | "Closed";

export type ExclusionReason = "rounds_to_zero" | "zero_address" | "vault" | "manager" | "token_self";

export interface ActionRow {
  action_id: number;
  payment_token: string;
  asset: string;
  record_block: string;
  total_amount: string;
  holder_set_hash: string;
  running_hash: string | null;
  next_index: number;
  total_holders: number;
  paid_count: number;
  escrowed_count: number;
  coverage_complete: boolean | null;
  status: ActionStatus;
  declare_tx_hash: string | null;
  declared_at: string;
  closed_at: string | null;
}

export interface ActionBatch {
  batch_index: number;
  holders: string[];
  amounts: string[];
  batch_total: string;
  expected_hash: string | null;
  tx_hash: string | null;
}

export interface SnapshotRow {
  holder: string;
  asset_balance: string;
  entitlement: string;
  included: boolean;
  exclusion_reason: ExclusionReason | null;
  batch_index: number | null;
  position_in_batch: number | null;
}

export interface ActionDetail extends ActionRow {
  commitmentParity: boolean;
  batches: ActionBatch[];
  snapshot: SnapshotRow[];
  excluded: SnapshotRow[];
}

export interface PreparePlanResponse {
  actionId: number;
  status: "Prepared";
  token: string;
  asset: string;
  recordBlock: string;
  totalAmount: string;
  holderSetHash: string;
  totalHolders: number;
  sumEntitlements: string;
  excluded: { holder: string; assetBalance: string; reason: ExclusionReason }[];
  batches: { batchIndex: number; holders: number; batchTotal: string; expectedHash: string }[];
  declareCalldata: `0x${string}`;
  to: `0x${string}`;
}

export interface PrepareBody {
  token: string;
  asset: string;
  recordBlock: string;
  totalAmount: string;
  batchSize?: number;
}

export interface BatchCalldataResponse {
  actionId: number;
  batchIndex: number;
  to: `0x${string}`;
  holders: string[];
  amounts: string[];
  batchTotal: string;
  expectedHash: string | null;
  txHash: string | null;
  onChainNextIndex: number | null;
  alreadyExecuted: boolean;
  note: string | null;
  calldata: `0x${string}`;
}

export function getActions() {
  return apiFetch<ActionRow[]>("/actions");
}

export function getAction(id: number | string) {
  return apiFetch<ActionDetail>(`/actions/${id}`);
}

export function prepareAction(body: PrepareBody) {
  return apiFetch<PreparePlanResponse>("/actions/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getBatchCalldata(id: number | string, index: number) {
  return apiFetch<BatchCalldataResponse>(`/actions/${id}/batch-calldata?index=${index}`);
}

// --- Escrow / Omnibus ledger --------------------------------------------------------

export type EscrowDecodedReason = "frozen" | "expired" | "no_apass" | "other";

export interface EscrowCounts {
  escrowed: number;
  expired: number;
  frozen: number;
  noApass: number;
  unclassified: number;
  forfeited: number;
}

export interface EscrowInvariant {
  totalHeld: string;
  vaultBalance: string;
  surplus: string;
  holds: boolean;
  statement: string;
}

export interface EscrowLiveBalance {
  beneficiary: string;
  held: string;
}

export interface EscrowDeposit {
  txHash: string;
  logIndex: number;
  blockNumber: number | string;
  beneficiary: string;
  token: string;
  amount: string;
  actionId: number;
  onChainReason: "FROZEN" | "EXPIRED" | "RETURNED_FALSE" | "UNKNOWN_REVERT" | string;
  reasonSelector: string;
  offender: string | null;
  rawRevert: string | null;
  decodedReason: EscrowDecodedReason;
  explanation: string;
  decodedBeyondOnChainTag: boolean;
}

export interface EscrowRelease {
  txHash: string;
  blockNumber: number | string;
  beneficiary: string;
  amount: string;
  trigger: string;
  inferredActionId: number | null;
  attributionCertain: boolean;
  attributionNote: string;
}

export interface EscrowResponse {
  token: string;
  counts: EscrowCounts;
  invariant: EscrowInvariant;
  liveBalances: EscrowLiveBalance[];
  deposits: EscrowDeposit[];
  releases: EscrowRelease[];
}

export function getEscrow() {
  return apiFetch<EscrowResponse>("/escrow");
}

// --- Audit export -------------------------------------------------------------------

export type LegOutcome = "paid" | "escrowed";

export interface AuditReport {
  url?: string | null;
  cached?: boolean;
  stored?: boolean;
  bytes?: number;
  fileName?: string | null;
  servedAt?: string | null;
  error?: string;
}

export interface AuditLeg {
  holder: string;
  amount: string;
  outcome: LegOutcome;
  txHash: string;
  blockNumber: number | string;
  reasonSelector: string | null;
  participationVerified: boolean;
  reportEligible: boolean;
  reportStatus: string;
  report: AuditReport | null;
}

export interface AuditCoverage {
  totalLegs: number;
  paid: number;
  escrowed: number;
  reportable: number;
  withoutReportByDesign: number;
  summary: string;
  forfeited: number;
}

export interface AuditEscrowDeposit {
  tx_hash: string;
  log_index: number;
  block_number: number | string;
  beneficiary: string;
  token: string;
  amount: string;
  action_id: number;
  reason_selector: string;
  offender: string | null;
}

export interface AuditResponse {
  action: ActionRow & { commitmentParity: boolean };
  coverage: AuditCoverage;
  legs: AuditLeg[];
  escrowDeposits: AuditEscrowDeposit[];
  snapshot: SnapshotRow[];
  excluded: SnapshotRow[];
  note: string;
}

export function getActionAudit(id: number | string, fetchReports?: boolean) {
  const qs = fetchReports ? "?fetchReports=true" : "";
  return apiFetch<AuditResponse>(`/actions/${id}/audit${qs}`);
}

// --- Register: onboarding, stats, per-wallet history --------------------------------

export interface StatsResponse {
  asset: string;
  capTable: { totalHolders: number; totalSupply: string };
  identity: { active: number; frozen: number; expired: number; no_apass: number };
  actions: { total: number; closed: number; open: number };
  value: { totalPaid: string; currentlyEscrowed: string; totalReleased: string };
}

export function getStats() {
  return apiFetch<StatsResponse>("/stats");
}

export interface OnboardBody {
  address: string;
  /** Raw TLNB units (whole integer) — the demo treats raw units as "units". */
  amount: string;
  label?: string;
}

export interface OnboardResponse {
  address: string;
  customerId: string;
  apassGenerated: boolean;
  cvRecordId: string | null;
  amount: string;
  asset: string;
  to: `0x${string}`;
  mintCalldata: `0x${string}`;
}

export function onboardHolder(body: OnboardBody) {
  return apiFetch<OnboardResponse>("/holders/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type HistoryEventType =
  | "mint"
  | "transfer_in"
  | "transfer_out"
  | "payout_paid"
  | "payout_escrowed"
  | "escrow_release";

export interface HistoryEvent {
  type: HistoryEventType;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  amount: string;
  detail: Record<string, unknown>;
}

export interface WalletHistoryResponse {
  wallet: string;
  asset: string;
  balance: string;
  identity: {
    state: string;
    hasApass: boolean;
    status: number | null;
    expirationTime: number | null;
    cvRecordId: string | null;
    customerId: string | null;
  };
  events: HistoryEvent[];
}

export function getWalletHistory(wallet: string) {
  return apiFetch<WalletHistoryResponse>(`/holders/${wallet}/history`);
}
