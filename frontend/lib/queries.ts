"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getAction,
  getActionAudit,
  getActions,
  getEscrow,
  getHolders,
  getIdentity,
  getStats,
  getVaultHealth,
  getWalletHistory,
} from "@/lib/api";

// Register polls at the same cadence as escrow: both reflect slow-moving,
// poller-synced state (A-Pass status, live escrow balances) rather than an
// in-progress execute run.
const HOLDERS_REFETCH_MS = 30_000;
const VAULT_HEALTH_REFETCH_MS = 30_000;
const ESCROW_REFETCH_MS = 30_000;

// Actions list polls faster than register/escrow because a Declared action
// can move through Executing batches within seconds during a live demo.
const ACTIONS_REFETCH_MS = 15_000;

// Action detail polls fastest of all — this is the page open during an
// active execute/close run, where batch progress needs to feel live.
const ACTION_DETAIL_REFETCH_MS = 10_000;

export function useHolders() {
  return useQuery({
    queryKey: ["holders"],
    queryFn: getHolders,
    refetchInterval: HOLDERS_REFETCH_MS,
  });
}

export function useVaultHealth() {
  return useQuery({
    queryKey: ["vault-health"],
    queryFn: getVaultHealth,
    refetchInterval: VAULT_HEALTH_REFETCH_MS,
  });
}

export function useActions() {
  return useQuery({
    queryKey: ["actions"],
    queryFn: getActions,
    refetchInterval: ACTIONS_REFETCH_MS,
  });
}

export function useAction(id: string | number) {
  return useQuery({
    queryKey: ["action", String(id)],
    queryFn: () => getAction(id),
    refetchInterval: ACTION_DETAIL_REFETCH_MS,
  });
}

/**
 * `enabled` exists for callers that are mounted everywhere but only sometimes
 * need this data — the sidebar's wallet card wants a connected holder's escrow
 * balance and nothing else, and it shouldn't put /escrow on a 30s poll for every
 * page in the app just by being visible.
 */
export function useEscrow(enabled = true) {
  return useQuery({
    queryKey: ["escrow"],
    queryFn: getEscrow,
    refetchInterval: ESCROW_REFETCH_MS,
    enabled,
  });
}

// Register-wide dashboard stats: same slow cadence as the cap table.
export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
    refetchInterval: HOLDERS_REFETCH_MS,
  });
}

// A single wallet's history timeline. Only fetched when a wallet is selected.
export function useWalletHistory(wallet: string | null) {
  return useQuery({
    queryKey: ["wallet-history", wallet],
    queryFn: () => getWalletHistory(wallet as string),
    enabled: Boolean(wallet),
    refetchInterval: HOLDERS_REFETCH_MS,
  });
}

/**
 * One wallet's live on-chain eligibility.
 *
 * `watch` turns on a 3s poll: after a freeze the chain lags Cleanverse by a few seconds,
 * and this is what watches it actually land. Off the rest of the time — this probe costs
 * a simulated transfer per call and there is nothing to see when nothing is changing.
 */
export function useIdentity(wallet: string | null, watch = false) {
  return useQuery({
    queryKey: ["identity", wallet],
    queryFn: () => getIdentity(wallet as string),
    enabled: Boolean(wallet),
    refetchInterval: watch ? 3_000 : false,
  });
}

// Audit doesn't poll — a Closed action's audit pack is static, and polling
// while `fetchReports=true` would needlessly re-request Cleanverse reports.
export function useActionAudit(id: number | null, fetchReports: boolean) {
  return useQuery({
    queryKey: ["audit", id, fetchReports],
    queryFn: () => getActionAudit(id as number, fetchReports),
    enabled: id !== null,
  });
}
