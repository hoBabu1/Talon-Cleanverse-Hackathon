"use client";

import { ChevronLeft, ChevronRight, ScrollText, Search, SlidersHorizontal, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionsDashboard } from "@/components/app/actions-dashboard";
import { ActionListItem } from "@/components/app/action-list-item";
import { STATUS_META } from "@/components/app/action-status";
import { ErrorState } from "@/components/app/error-state";
import Reveal from "@/components/landing/Reveal";
import { type ActionRow, type ActionStatus } from "@/lib/api";
import { useIsOwner } from "@/lib/hooks/useIsOwner";
import { useActions } from "@/lib/queries";

const PER_PAGE = 5;
const STATUSES: ActionStatus[] = ["Declared", "Executing", "Closed", "Prepared"];

export default function ActionsHistoryPage() {
  const actionsQuery = useActions();
  const { isOwner } = useIsOwner();

  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Set<ActionStatus>>(new Set());
  const [coverage, setCoverage] = useState<Set<"complete" | "incomplete">>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);

  const actions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data]);
  const resetPage = () => setPage(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const numeric = /^\d+$/.test(needle);
    const out = actions.filter((a: ActionRow) => {
      if (statuses.size > 0 && !statuses.has(a.status)) return false;
      if (coverage.size > 0) {
        const cov = a.coverage_complete === true ? "complete" : a.coverage_complete === false ? "incomplete" : null;
        if (!cov || !coverage.has(cov)) return false;
      }
      if (needle) {
        // A bare number targets the action id (so "9" finds action #9), otherwise
        // match token / asset addresses.
        const ok = numeric
          ? String(a.action_id).includes(needle)
          : `${a.payment_token} ${a.asset}`.toLowerCase().includes(needle);
        if (!ok) return false;
      }
      return true;
    });
    return [...out].sort((a, b) => b.action_id - a.action_id);
  }, [actions, query, statuses, coverage]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);

  const toggleStatus = (s: ActionStatus) => {
    setStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
    resetPage();
  };
  const toggleCoverage = (c: "complete" | "incomplete") => {
    setCoverage((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
    resetPage();
  };
  const filterCount = statuses.size + coverage.size;
  const clearFilters = () => {
    setStatuses(new Set());
    setCoverage(new Set());
    resetPage();
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Corporate action history</h1>
          <p className="mt-1 text-sm text-muted">
            Every declared distribution — record date, settlement, coverage, and the on-chain commitment.
          </p>
        </div>
        {isOwner && (
          <Link
            href="/actions"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_36px_rgba(248,101,28,0.28)] transition-all hover:-translate-y-0.5 hover:bg-[#ff7a38]"
          >
            <UserPlus size={16} /> Declare action
          </Link>
        )}
      </Reveal>

      <Reveal className="mb-8">
        <ActionsDashboard actions={actions} loading={actionsQuery.isLoading} />
      </Reveal>

      {/* search + filter bar */}
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
                placeholder="Search by action #, token, or asset…"
                className="w-full rounded-[14px] border border-transparent bg-ink py-2.5 pl-11 pr-3 text-sm text-white placeholder:text-muted/70 focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className={`relative inline-flex items-center gap-1.5 rounded-[14px] border px-3 py-2.5 text-xs font-medium transition-colors ${
                showFilters || filterCount > 0
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-edge text-muted hover:border-accent/50 hover:text-white"
              }`}
            >
              <SlidersHorizontal size={14} /> Filters
              {filterCount > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {filterCount}
                </span>
              )}
            </button>
          </div>

          {showFilters && (
            <div className="mt-2 flex flex-col gap-3 border-t border-edge px-1 pt-3">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/50">Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => {
                    const meta = STATUS_META[s];
                    const on = statuses.has(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleStatus(s)}
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

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/50">Coverage</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(["complete", "incomplete"] as const).map((c) => {
                    const on = coverage.has(c);
                    const tone = c === "complete" ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" : "text-amber-400 bg-amber-400/10 border-amber-400/20";
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCoverage(c)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                          on ? tone : "border-edge text-muted hover:text-white"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${on ? (c === "complete" ? "bg-emerald-400" : "bg-amber-400") : "bg-muted/40"}`} />
                        {c}
                      </button>
                    );
                  })}
                  {filterCount > 0 && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ml-1 inline-flex items-center gap-1 rounded-full border border-edge px-3 py-1 text-xs text-muted transition-colors hover:border-red-400/40 hover:text-red-300"
                    >
                      <X size={12} /> Clear all
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Reveal>

      {actionsQuery.isError ? (
        <div className="mt-4">
          <ErrorState message={`Couldn't load actions: ${(actionsQuery.error as Error).message}`} />
        </div>
      ) : (
        <>
          <div className="mb-2 mt-4 flex items-center justify-between px-1 text-xs text-muted">
            <span>{actionsQuery.isLoading ? "Loading…" : `${filtered.length} action${filtered.length === 1 ? "" : "s"}`}</span>
            {filtered.length > 0 && (
              <span>
                Showing {safePage * PER_PAGE + 1}–{Math.min((safePage + 1) * PER_PAGE, filtered.length)} of {filtered.length}
              </span>
            )}
          </div>

          <Reveal className="flex flex-col gap-2.5">
            {actionsQuery.isLoading ? (
              Array.from({ length: PER_PAGE }).map((_, i) => (
                <div key={i} className="h-[120px] animate-pulse rounded-card border border-edge bg-card" />
              ))
            ) : pageRows.length === 0 ? (
              <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-12 text-center text-sm text-muted">
                <ScrollText size={22} className="mx-auto mb-2 text-muted/40" />
                No actions match your filters.
              </div>
            ) : (
              pageRows.map((a) => <ActionListItem key={a.action_id} action={a} />)
            )}
          </Reveal>

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
