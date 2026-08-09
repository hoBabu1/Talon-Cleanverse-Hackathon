"use client";

import {
  AlertTriangle,
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Search,
  SlidersHorizontal,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/app/badge";
import { ErrorState } from "@/components/app/error-state";
import { STATE_META, relativeTime } from "@/components/app/holder-card";
import { IdentityGem } from "@/components/app/identity-gem";
import { RegisterDashboard } from "@/components/app/register-dashboard";
import Reveal from "@/components/landing/Reveal";
import { shortAddress } from "@/lib/site";
import { type DisplayState, type Holder } from "@/lib/api";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useHolders, useVaultHealth } from "@/lib/queries";

const PER_PAGE = 5;
const FILTERABLE: DisplayState[] = ["active", "frozen", "expired", "no_apass", "unknown"];

function fmtUnits(raw: string): string {
  try {
    return BigInt(raw).toLocaleString("en-US");
  } catch {
    return raw;
  }
}

function syncedLabel(h: Holder): string {
  if (!h.lastSyncedAt) return "never synced";
  const ago = relativeTime(h.lastSyncedAt);
  return h.stale ? `last known ${ago}` : `synced ${ago}`;
}

export default function RegisterPage() {
  const holdersQuery = useHolders();
  const vaultHealthQuery = useVaultHealth();
  const { isOwner } = useIsOwner();

  const [query, setQuery] = useState("");
  const [identity, setIdentity] = useState<Set<DisplayState>>(new Set());
  const [minBal, setMinBal] = useState("");
  const [maxBal, setMaxBal] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);

  const holders = useMemo(() => holdersQuery.data?.holders ?? [], [holdersQuery.data]);
  const anyStale = holdersQuery.data?.anyStale ?? false;
  const vaultHealth = vaultHealthQuery.data;

  const totalSupply = useMemo(
    () => holders.reduce((acc, h) => acc + BigInt(h.balance), BigInt(0)),
    [holders],
  );

  const resetPage = () => setPage(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const min = minBal.trim() ? BigInt(minBal.trim()) : null;
    const max = maxBal.trim() ? BigInt(maxBal.trim()) : null;

    const out = holders.filter((h) => {
      if (needle && !h.wallet.toLowerCase().includes(needle)) return false;
      if (identity.size > 0 && !identity.has(h.displayState)) return false;
      const bal = BigInt(h.balance);
      if (min !== null && bal < min) return false;
      if (max !== null && bal > max) return false;
      return true;
    });

    return out.sort((a, b) => {
      const av = BigInt(a.balance);
      const bv = BigInt(b.balance);
      if (av === bv) return 0;
      const asc = av < bv ? -1 : 1;
      return sortDesc ? -asc : asc;
    });
  }, [holders, query, identity, minBal, maxBal, sortDesc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const toggleIdentity = (s: DisplayState) => {
    setIdentity((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
    resetPage();
  };

  const activeFilterCount = identity.size + (minBal.trim() ? 1 : 0) + (maxBal.trim() ? 1 : 0);
  const clearFilters = () => {
    setIdentity(new Set());
    setMinBal("");
    setMaxBal("");
    resetPage();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Cap table</h1>
          <p className="mt-1 text-sm text-muted">
            The live register — every Cleanverse-verified holder of the bond, with identity status.
          </p>
        </div>
        {isOwner && (
          <Link
            href="/register/onboard"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_36px_rgba(248,101,28,0.28)] transition-all hover:-translate-y-0.5 hover:bg-[#ff7a38]"
          >
            <UserPlus size={16} /> Onboard holder
          </Link>
        )}
      </Reveal>

      <Reveal className="mb-8">
        <RegisterDashboard />
      </Reveal>

      {vaultHealth && !vaultHealth.healthy && (
        <Reveal>
          <div className="mb-4 flex items-start gap-3 rounded-card border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Vault credential unhealthy</p>
              <p className="mt-0.5 text-red-300/80">
                The escrow vault&apos;s own A-Pass isn&apos;t active — every holder&apos;s claim can fail until this is
                resolved.
              </p>
            </div>
          </div>
        </Reveal>
      )}

      {anyStale && (
        <div className="mb-4 rounded-card border border-edge bg-card px-4 py-2.5 text-xs text-muted">
          Some rows show last-known state — the sync poller hasn&apos;t confirmed them recently.
        </div>
      )}

      {/* Search + controls bar */}
      <Reveal>
        <div className="rounded-card border border-edge bg-card/60 p-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <div className="group relative flex-1">
              <Search
                size={17}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted transition-colors group-focus-within:text-accent"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetPage();
                }}
                placeholder="Search a wallet address…"
                aria-label="Search holders by wallet address"
                className="w-full rounded-[14px] border border-transparent bg-ink py-2.5 pl-11 pr-3 text-sm text-white placeholder:text-muted/70 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <button
              type="button"
              onClick={() => setSortDesc((v) => !v)}
              title={sortDesc ? "Largest holders first" : "Smallest holders first"}
              className="inline-flex items-center gap-1.5 rounded-[14px] border border-edge px-3 py-2.5 text-xs font-medium text-muted transition-colors hover:border-accent/50 hover:text-white"
            >
              <ArrowDownUp size={14} /> {sortDesc ? "High" : "Low"}
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`relative inline-flex items-center gap-1.5 rounded-[14px] border px-3 py-2.5 text-xs font-medium transition-colors ${
                showFilters || activeFilterCount > 0
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-edge text-muted hover:border-accent/50 hover:text-white"
              }`}
            >
              <SlidersHorizontal size={14} /> Filters
              {activeFilterCount > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {showFilters && (
            <div className="mt-2 flex flex-col gap-3 border-t border-edge px-1 pt-3">
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/60">
                  <ListFilter size={12} /> Identity
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERABLE.map((s) => {
                    const meta = STATE_META[s];
                    const on = identity.has(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleIdentity(s)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          on ? `${meta.bg} ${meta.border} ${meta.text}` : "border-edge text-muted hover:text-white"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${on ? meta.text.replace("text-", "bg-") : "bg-muted/40"}`} />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted/60">
                  Min balance
                  <input
                    value={minBal}
                    onChange={(e) => {
                      setMinBal(e.target.value.replace(/[^\d]/g, ""));
                      resetPage();
                    }}
                    inputMode="numeric"
                    placeholder="0"
                    className="w-28 rounded-[12px] border border-edge bg-ink px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted/60">
                  Max balance
                  <input
                    value={maxBal}
                    onChange={(e) => {
                      setMaxBal(e.target.value.replace(/[^\d]/g, ""));
                      resetPage();
                    }}
                    inputMode="numeric"
                    placeholder="∞"
                    className="w-28 rounded-[12px] border border-edge bg-ink px-3 py-1.5 text-sm text-white outline-none focus:border-accent"
                  />
                </label>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1.5 text-xs text-muted transition-colors hover:border-red-400/40 hover:text-red-300"
                  >
                    <X size={12} /> Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Reveal>

      {/* Results */}
      {holdersQuery.isError ? (
        <div className="mt-4">
          <ErrorState message={`Couldn't load the cap table: ${(holdersQuery.error as Error).message}`} />
        </div>
      ) : (
        <>
          <div className="mb-2 mt-4 flex items-center justify-between px-1 text-xs text-muted">
            <span>
              {holdersQuery.isLoading
                ? "Loading…"
                : `${filtered.length} holder${filtered.length === 1 ? "" : "s"}${
                    activeFilterCount || query.trim() ? " match" : ""
                  }`}
            </span>
            {filtered.length > 0 && (
              <span>
                Showing {safePage * PER_PAGE + 1}–{Math.min((safePage + 1) * PER_PAGE, filtered.length)} of {filtered.length}
              </span>
            )}
          </div>

          <Reveal className="flex flex-col gap-2">
            {holdersQuery.isLoading ? (
              Array.from({ length: PER_PAGE }).map((_, i) => (
                <div key={i} className="h-[70px] animate-pulse rounded-card border border-edge bg-card" />
              ))
            ) : pageRows.length === 0 ? (
              <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-12 text-center text-sm text-muted">
                No holders match your filters.
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters} className="ml-1 text-accent hover:underline">
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              pageRows.map((h, i) => (
                <HolderListItem key={h.wallet} holder={h} rank={safePage * PER_PAGE + i + 1} totalSupply={totalSupply} />
              ))
            )}
          </Reveal>

          {/* Pagination */}
          {filtered.length > PER_PAGE && (
            <div className="mt-4 flex items-center justify-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-edge px-3 text-xs text-muted transition-colors hover:border-accent/50 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              {Array.from({ length: pageCount }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${
                    i === safePage ? "bg-accent text-white" : "border border-edge text-muted hover:text-white"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-edge px-3 text-xs text-muted transition-colors hover:border-accent/50 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HolderListItem({ holder, rank, totalSupply }: { holder: Holder; rank: number; totalSupply: bigint }) {
  const meta = STATE_META[holder.displayState];
  const bal = BigInt(holder.balance);
  const pct = totalSupply > BigInt(0) ? Number((bal * BigInt(10000)) / totalSupply) / 100 : 0;

  return (
    <Link
      href={`/register/${holder.wallet}`}
      className={`group flex items-center gap-3 rounded-card border border-edge bg-card p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[0_12px_30px_-14px_rgba(248,101,28,0.4)] md:gap-4 md:p-4 ${
        holder.stale ? "opacity-70" : ""
      }`}
    >
      <span className="hidden w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-muted/50 sm:block">
        {rank}
      </span>
      <IdentityGem address={holder.wallet} />

      <div className="min-w-0 flex-1">
        <span className="font-mono text-sm text-white transition-colors group-hover:text-accent">
          {shortAddress(holder.wallet)}
        </span>
        <div className="mt-1 flex items-center gap-2">
          <Badge meta={meta} />
          <span className="hidden truncate text-xs text-muted sm:block">{syncedLabel(holder)}</span>
        </div>
      </div>

      <div className="w-28 shrink-0 text-right md:w-40">
        <p className="text-sm font-semibold tabular-nums text-white">{fmtUnits(holder.balance)}</p>
        <div className="mt-1.5 hidden h-1.5 overflow-hidden rounded-full bg-ink md:block">
          <div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(pct, 1.5)}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-muted/70">{pct.toFixed(1)}% of supply</p>
      </div>

      <ChevronRight size={16} className="shrink-0 text-muted/40 transition-colors group-hover:text-accent" />
    </Link>
  );
}
