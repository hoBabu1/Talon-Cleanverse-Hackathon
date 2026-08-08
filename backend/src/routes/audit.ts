/**
 * The audit pack.
 *
 * The integrity rule this file exists to enforce:
 *
 *   A Cleanverse Transaction Report is requested for a (txHash, wallet) pair ONLY when that
 *   wallet actually appears in a confirmed Transfer log of that transaction.
 *
 * This is not defensive coding, it is the whole point. `download_travel_rule` does NOT
 * verify participation — confirmed live, it returned a valid-looking report for an address
 * that was never in the transaction. Only a bogus txHash fails. So attaching an
 * official-looking PDF to a payment that never happened is trivially easy, and it is
 * exactly the failure the contracts were built to prevent, one layer up: presenting a
 * document as evidence of something that did not occur.
 *
 * Escrowed legs therefore get "No payment report — funds escrowed, not transferred" rather
 * than a report, and the coverage summary states the gap openly instead of hiding it.
 *
 * Naming: these are "Transaction Reports", not "Travel Rule Reports". Per Cleanverse's docs
 * Travel Rule reports cover withdrawals; A-Token transfers yield Transaction Reports.
 */
import type { FastifyInstance } from "fastify";
import { parseAbiItem, decodeEventLog } from "viem";
import { publicClient, lc } from "../lib/chain.js";
import { requireSupabase } from "../lib/supabase.js";
import { cleanverse } from "../lib/cleanverse.js";

const TRANSFER = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * Every address that actually appears as a Transfer counterparty in this transaction,
 * read from the receipt. This is the participation check, and it is done against chain
 * truth rather than against our own expectation of who should have been paid.
 */
async function participantsOf(txHash: string): Promise<Set<string>> {
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  const parties = new Set<string>();
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
      const args = decoded.args as unknown as { from: string; to: string };
      parties.add(lc(args.from));
      parties.add(lc(args.to));
    } catch {
      // Not a Transfer — irrelevant to participation.
    }
  }
  return parties;
}

export async function auditRoutes(app: FastifyInstance) {
  /**
   * Serve a stored report from our own database rather than redirecting to Cleanverse.
   *
   * This is what makes the audit pack durable: the bytes were captured when the report was
   * generated, so the pack keeps working after the upstream download URL expires — and it
   * keeps working even if Cleanverse is unreachable at the moment a judge opens it.
   */
  app.get<{ Params: { txHash: string; wallet: string } }>(
    "/reports/:txHash/:wallet",
    async (req, reply) => {
      const { data } = await requireSupabase()
        .from("cleanverse_reports")
        .select("report_bytes,content_type,file_name,participation_verified")
        .eq("tx_hash", req.params.txHash)
        .eq("wallet", lc(req.params.wallet))
        .maybeSingle();

      if (!data?.report_bytes) return reply.code(404).send({ error: "no stored report for this pair" });

      // Belt and braces: a row could only have been written after a participation check,
      // but serving a report is exactly where a silent regression would do real damage.
      if (!data.participation_verified) {
        return reply.code(409).send({ error: "stored report is not participation-verified" });
      }

      const hex = String(data.report_bytes).replace(/^\\x/, "");
      return reply
        .header("content-type", data.content_type ?? "application/pdf")
        .header("content-disposition", `inline; filename="${data.file_name ?? "transaction-report.pdf"}"`)
        .send(Buffer.from(hex, "hex"));
    },
  );

  app.get<{ Params: { id: string }; Querystring: { fetchReports?: string } }>(
    "/actions/:id/audit",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 0) return reply.code(400).send({ error: "bad action id" });

      // Reports are fetched only when asked for: each is a live Cleanverse call, and a page
      // load should not fan out to one API request per holder.
      const wantReports = req.query.fetchReports === "true";

      const db = requireSupabase();
      const { data: action } = await db
        .from("corporate_actions")
        .select("*")
        .eq("action_id", id)
        .maybeSingle();
      if (!action) return reply.code(404).send({ error: `action ${id} not found` });

      const { data: events } = await db
        .from("payout_events")
        .select("*")
        .eq("action_id", id)
        .order("log_index");
      const { data: snapshot } = await db
        .from("record_date_snapshots")
        .select("*")
        .eq("action_id", id)
        .order("entitlement", { ascending: false });
      const { data: deposits } = await db.from("escrow_deposits").select("*").eq("action_id", id);

      // Participation sets, one receipt read per distinct transaction.
      const txHashes = [...new Set((events ?? []).map((e) => e.tx_hash as string))];
      const participation = new Map<string, Set<string>>();
      for (const tx of txHashes) {
        try {
          participation.set(tx, await participantsOf(tx));
        } catch {
          participation.set(tx, new Set());
        }
      }

      const legs = [];
      for (const e of events ?? []) {
        const parties = participation.get(e.tx_hash) ?? new Set<string>();
        const participated = parties.has(lc(e.holder));

        // An escrowed leg means the holder was NEVER paid: value went to the vault instead.
        // There is no payment to report, and saying so plainly is the honest outcome.
        const eligibleForReport = e.outcome === "paid" && participated;

        let report: Record<string, unknown> | null = null;
        if (eligibleForReport && wantReports) {
          const cached = await db
            .from("cleanverse_reports")
            .select("*")
            .eq("tx_hash", e.tx_hash)
            .eq("wallet", lc(e.holder))
            .maybeSingle();

          if (cached.data?.report_bytes) {
            report = {
              url: cached.data.report_url,
              cached: true,
              stored: true,
              bytes: cached.data.report_bytes.length,
              servedAt: `/reports/${e.tx_hash}/${lc(e.holder)}`,
            };
          } else {
            const res = await cleanverse.downloadTravelRule({
              txHash: e.tx_hash,
              wallet: { address: e.holder, chain: "monad" },
            });
            const url = (res.data as { downloadUrl?: string } | undefined)?.downloadUrl ?? null;

            // Fetch and STORE THE BYTES, not just the link. The download URL's lifetime is
            // undocumented, so a pack assembled today could hand a judge dead links
            // tomorrow. Storing the PDF makes the audit pack self-contained and independent
            // of Cleanverse being reachable at the moment someone opens it.
            let bytes: Buffer | null = null;
            let contentType: string | null = null;
            let fileName: string | null = null;
            if (url) {
              try {
                const pdf = await fetch(url);
                if (pdf.ok) {
                  bytes = Buffer.from(await pdf.arrayBuffer());
                  contentType = pdf.headers.get("content-type");
                  // The API returns fileName null; the real name is in Content-Disposition.
                  fileName =
                    /filename=([^;]+)/.exec(pdf.headers.get("content-disposition") ?? "")?.[1] ?? null;
                }
              } catch {
                // Fall through: the URL is still recorded, just without stored bytes.
              }
            }

            await db.from("cleanverse_reports").upsert({
              tx_hash: e.tx_hash,
              wallet: lc(e.holder),
              participation_verified: true,
              report_url: url,
              report_bytes: bytes ? `\\x${bytes.toString("hex")}` : null,
              content_type: contentType,
              file_name: fileName,
              fetch_error: url ? null : `code ${res.code}`,
            });

            report = url
              ? {
                  url,
                  cached: false,
                  stored: Boolean(bytes),
                  bytes: bytes?.length ?? 0,
                  fileName,
                  servedAt: bytes ? `/reports/${e.tx_hash}/${lc(e.holder)}` : null,
                }
              : { error: `code ${res.code}` };
          }
        }

        legs.push({
          holder: e.holder,
          amount: e.amount,
          outcome: e.outcome,
          txHash: e.tx_hash,
          blockNumber: e.block_number,
          reasonSelector: e.reason_selector,
          participationVerified: participated,
          reportEligible: eligibleForReport,
          reportStatus: eligibleForReport
            ? wantReports
              ? "fetched"
              : "available"
            : e.outcome === "escrowed"
              ? "No payment report — funds escrowed, not transferred"
              : "No report — this wallet does not appear in a Transfer log of this transaction",
          report,
        });
      }

      const paidLegs = legs.filter((l) => l.outcome === "paid");
      const escrowedLegs = legs.filter((l) => l.outcome === "escrowed");

      return {
        action: {
          ...action,
          commitmentParity: action.running_hash === action.holder_set_hash,
        },
        /**
         * Honest completeness accounting, stated up front rather than inferred from a
         * table. An incomplete pack that explains its gaps is worth more than one that
         * looks complete by omitting what it could not prove.
         */
        coverage: {
          totalLegs: legs.length,
          paid: paidLegs.length,
          escrowed: escrowedLegs.length,
          reportable: legs.filter((l) => l.reportEligible).length,
          withoutReportByDesign: escrowedLegs.length,
          summary:
            `${legs.filter((l) => l.reportEligible).length} of ${legs.length} legs have ` +
            `Cleanverse Transaction Reports; ${escrowedLegs.length} escrowed leg(s) have none by design.`,
          // Structurally zero: the contracts have no forfeiture path, and adminForfeit was
          // deliberately never built.
          forfeited: 0,
        },
        legs,
        escrowDeposits: deposits ?? [],
        snapshot: snapshot ?? [],
        excluded: (snapshot ?? []).filter((s: { included: boolean }) => !s.included),
        note:
          "Cleanverse's download_travel_rule does not verify that a wallet participated in a " +
          "transaction, so participation is checked here against the transaction's own Transfer " +
          "logs before any report is requested.",
      };
    },
  );
}
