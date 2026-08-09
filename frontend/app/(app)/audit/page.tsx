"use client";

import {
  CheckCircle2,
  CircleSlash,
  Download,
  FileText,
  LayoutGrid,
  ListChecks,
  Printer,
  ShieldCheck,
  ShieldQuestion,
  Snowflake,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { EXCLUSION_REASON_LABEL } from "@/components/app/action-status";
import AppButton from "@/components/app/app-button";
import { Badge } from "@/components/app/badge";
import { IdentityGem } from "@/components/app/identity-gem";
import { ErrorState } from "@/components/app/error-state";
import Reveal from "@/components/landing/Reveal";
import { ApiError, type ActionRow, type AuditLeg, type LegOutcome } from "@/lib/api";
import { useTokenDecimals } from "@/lib/hooks/useTokenDecimals";
import { useActionAudit, useActions } from "@/lib/queries";
import { shortAddress } from "@/lib/site";

const OUTCOME_META: Record<LegOutcome, { label: string; text: string; bg: string; border: string }> = {
  paid: { label: "Paid", text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" },
  escrowed: { label: "Escrowed", text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
};

const SELECTOR_LABEL: Record<string, string> = {
  "0x322fde89": "Frozen",
  "0xaecc0dbe": "Expired",
  "0x4731ab32": "Returned false",
  "0x19957115": "Unknown revert",
};

const COVERAGE_TONE = {
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  white: "text-white",
} as const;

function CoverageTile({ label, value, tone }: { label: string; value: number; tone: keyof typeof COVERAGE_TONE }) {
  return (
    <div className="rounded-card border border-edge bg-ink p-3 transition-colors hover:border-accent/40">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted/70">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${COVERAGE_TONE[tone]}`}>{value}</p>
    </div>
  );
}

function ReportCell({ leg, apiBase }: { leg: AuditLeg; apiBase: string }) {
  if (leg.report?.servedAt) {
    return (
      <a
        href={`${apiBase}${leg.report.servedAt}`}
        target="_blank"
        rel="noreferrer"
        className="no-print inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
      >
        <FileText size={14} /> View report
      </a>
    );
  }
  if (leg.report && !leg.report.servedAt) {
    return <span className="text-xs text-muted">{leg.reportStatus === "fetched" ? "Fetched, no stored bytes" : leg.reportStatus}</span>;
  }
  return <span className="text-xs text-muted">{leg.reportStatus}</span>;
}

function LegItem({ leg, decimals, apiBase }: { leg: AuditLeg; decimals: number; apiBase: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-edge bg-card p-3 md:p-4">
      <IdentityGem address={leg.holder} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm text-white" title={leg.holder}>
            {shortAddress(leg.holder)}
          </span>
          <Badge meta={OUTCOME_META[leg.outcome]} />
        </div>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
          {leg.participationVerified ? (
            <>
              <CheckCircle2 size={12} className="text-emerald-400" /> participation verified
            </>
          ) : (
            <>
              <XCircle size={12} className="text-red-400" /> participation unverified
            </>
          )}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-white">
          {formatUnits(BigInt(leg.amount), decimals)} <span className="text-[11px] font-normal text-muted">units</span>
        </p>
        <ReportCell leg={leg} apiBase={apiBase} />
      </div>
    </div>
  );
}

type TabId = "coverage" | "legs" | "escrow" | "excluded";

export default function AuditPage() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reportsRequested, setReportsRequested] = useState(false);
  const [tab, setTab] = useState<TabId>("coverage");

  const actionsQuery = useActions();
  const actions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data]);

  const defaultId = useMemo(() => {
    if (actions.length === 0) return null;
    const closed = actions.filter((a) => a.status === "Closed");
    const pool = closed.length > 0 ? closed : actions;
    return [...pool].sort((a, b) => b.action_id - a.action_id)[0].action_id;
  }, [actions]);

  const effectiveId = selectedId ?? defaultId;

  function selectAction(id: number) {
    setSelectedId(id);
    setReportsRequested(false);
    setTab("coverage");
  }

  const auditQuery = useActionAudit(effectiveId, reportsRequested);
  const { decimals } = useTokenDecimals(auditQuery.data?.action.payment_token);
  const data = auditQuery.data;

  const tabs: { id: TabId; label: string; icon: typeof LayoutGrid; count: number | null }[] = data
    ? [
        { id: "coverage", label: "Coverage", icon: LayoutGrid, count: null },
        { id: "legs", label: "Legs", icon: ListChecks, count: data.legs.length },
        { id: "escrow", label: "Escrow", icon: Snowflake, count: data.escrowDeposits.length },
        { id: "excluded", label: "Excluded", icon: CircleSlash, count: data.excluded.length },
      ]
    : [];

  function downloadJson() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `talon-audit-action-${data.action.action_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // On screen: only the active panel. On print: every panel, always.
  const panelClass = (id: TabId) => (tab === id ? "block" : "hidden print:block");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <Reveal className="mb-6 print-content">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Audit export</h1>
            <p className="mt-1 text-sm text-muted">Per-action coverage, participation, and Cleanverse Transaction Reports.</p>
          </div>
          <div className="no-print flex items-center gap-2">
            <select
              value={effectiveId ?? ""}
              onChange={(e) => selectAction(Number(e.target.value))}
              disabled={actions.length === 0}
              className="rounded-[14px] border border-edge bg-ink px-3 py-2.5 text-sm text-white outline-none focus:border-accent disabled:opacity-50"
            >
              {actions.length === 0 && <option value="">No actions</option>}
              {actions.map((a: ActionRow) => (
                <option key={a.action_id} value={a.action_id}>
                  Action #{a.action_id} — {a.status}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Reveal>

      {actionsQuery.isError && <ErrorState message="Couldn't load actions list." />}
      {auditQuery.isError && (
        <ErrorState
          message={`Couldn't load the audit pack: ${auditQuery.error instanceof ApiError ? auditQuery.error.message : (auditQuery.error as Error).message}`}
        />
      )}

      {(actionsQuery.isLoading || (auditQuery.isLoading && effectiveId !== null)) && !data && (
        <div className="flex flex-col gap-3">
          <div className="h-8 w-56 animate-pulse rounded bg-white/5" />
          <div className="h-40 animate-pulse rounded-card border border-edge bg-card" />
        </div>
      )}

      {data && (
        <div className="print-content">
          {/* Sticky command bar: identity + toolbar + tabs, all reachable without scrolling */}
          <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-edge bg-ink/85 px-4 pb-3 pt-2 backdrop-blur md:-mx-8 md:px-8 print:static print:border-0 print:bg-transparent print:backdrop-blur-none">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-[#c23f00] text-lg font-bold text-white shadow-[0_10px_30px_-8px_rgba(248,101,28,0.5)]">
                #{data.action.action_id}
              </span>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-white">Audit pack — action #{data.action.action_id}</h2>
                <p className="mt-0.5 truncate font-mono text-xs text-muted">
                  {shortAddress(data.action.payment_token)} → {shortAddress(data.action.asset)} · record block {data.action.record_block} · {data.action.status}
                </p>
              </div>
              <div className="no-print ml-auto flex flex-wrap items-center gap-2">
                <AppButton onClick={() => setReportsRequested(true)} disabled={reportsRequested && auditQuery.isFetching} loading={reportsRequested && auditQuery.isFetching}>
                  <FileText size={14} /> Fetch reports
                </AppButton>
                <AppButton variant="ghost" onClick={downloadJson}>
                  <Download size={14} /> JSON
                </AppButton>
                <AppButton variant="ghost" onClick={() => window.print()}>
                  <Printer size={14} /> Print
                </AppButton>
              </div>
            </div>

            {/* Tab bar — click lands you straight on the panel, no scroll */}
            <div className="no-print mt-3 flex flex-wrap gap-1.5">
              {tabs.map((t) => {
                const on = tab === t.id;
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      on ? "border-accent/40 bg-accent/10 text-accent" : "border-edge bg-card text-muted hover:border-accent/30 hover:text-white"
                    }`}
                  >
                    <Icon size={14} />
                    {t.label}
                    {t.count !== null && (
                      <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-accent/20 text-accent" : "bg-ink text-muted/70"}`}>
                        {t.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Coverage */}
          <section id="coverage" className={panelClass("coverage")}>
            <Reveal>
              <h3 className="mb-3 hidden text-lg font-semibold text-white print:block">Coverage</h3>
              <div className="rounded-card border border-edge bg-card p-4 md:p-6">
                <p className="text-sm text-white">{data.coverage.summary}</p>

                <div className="mt-3 flex items-center gap-2 text-sm">
                  {data.action.commitmentParity ? (
                    <>
                      <ShieldCheck size={16} className="text-emerald-400" />
                      <span className="text-emerald-400">Chained-hash commitment verified</span>
                    </>
                  ) : (
                    <>
                      <ShieldQuestion size={16} className="text-muted" />
                      <span className="text-muted">Chained-hash commitment not verified</span>
                    </>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
                  <CoverageTile label="Paid" value={data.coverage.paid} tone="emerald" />
                  <CoverageTile label="Escrowed" value={data.coverage.escrowed} tone="amber" />
                  <CoverageTile label="Reportable" value={data.coverage.reportable} tone="white" />
                  <CoverageTile label="No report" value={data.coverage.withoutReportByDesign} tone="white" />
                  <div className="rounded-card border border-emerald-400/30 bg-emerald-400/[0.06] p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">Forfeited</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{data.coverage.forfeited}</p>
                  </div>
                </div>

                <p className="mt-4 text-xs text-muted">{data.note}</p>
              </div>
            </Reveal>
          </section>

          {/* Legs */}
          <section id="legs" className={`${panelClass("legs")} print:mt-8`}>
            <Reveal>
              <h3 className="mb-3 text-lg font-semibold text-white">Legs</h3>
              {data.legs.length === 0 ? (
                <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-10 text-center text-sm text-muted">
                  No legs recorded for this action.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.legs.map((leg) => (
                    <LegItem key={`${leg.txHash}-${leg.holder}`} leg={leg} decimals={decimals} apiBase={apiBase} />
                  ))}
                </div>
              )}
            </Reveal>
          </section>

          {/* Escrow deposits */}
          <section id="escrow" className={`${panelClass("escrow")} print:mt-8`}>
            <Reveal>
              <h3 className="mb-3 text-lg font-semibold text-white">Escrow deposits</h3>
              {data.escrowDeposits.length === 0 ? (
                <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-8 text-center text-sm text-muted">
                  No escrow deposits for this action.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.escrowDeposits.map((d) => (
                    <div key={`${d.tx_hash}-${d.log_index}`} className="flex flex-wrap items-center gap-3 rounded-card border border-edge bg-card p-3 md:p-4">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400/10 text-amber-400" aria-hidden>
                        <Snowflake size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-sm text-white" title={d.beneficiary}>
                          {shortAddress(d.beneficiary)}
                        </span>
                        <p className="mt-0.5 text-xs text-muted">
                          {SELECTOR_LABEL[d.reason_selector] ?? d.reason_selector}
                          {d.offender && <span> · offender {shortAddress(d.offender)}</span>}
                        </p>
                      </div>
                      <span className="text-right text-sm font-semibold tabular-nums text-white">
                        {formatUnits(BigInt(d.amount), decimals)} <span className="text-[11px] font-normal text-muted">units</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Reveal>
          </section>

          {/* Excluded */}
          <section id="excluded" className={`${panelClass("excluded")} print:mt-8`}>
            <Reveal>
              <h3 className="mb-3 text-lg font-semibold text-white">Excluded from record-date snapshot</h3>
              {data.excluded.length === 0 ? (
                <div className="rounded-card border border-dashed border-edge bg-card/50 px-4 py-8 text-center text-sm text-muted">
                  No holders were excluded.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.excluded.map((e) => (
                    <div key={e.holder} className="flex items-center gap-3 rounded-card border border-edge bg-card p-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-400/10 text-zinc-400" aria-hidden>
                        <CircleSlash size={14} />
                      </span>
                      <span className="font-mono text-sm text-white">{shortAddress(e.holder)}</span>
                      <span className="ml-auto text-xs text-muted">
                        {e.exclusion_reason ? EXCLUSION_REASON_LABEL[e.exclusion_reason] : "excluded"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Reveal>
          </section>
        </div>
      )}
    </div>
  );
}
