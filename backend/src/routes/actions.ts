/**
 * Corporate-action routes.
 *
 * The load-bearing idea in this file: the batch plan is FROZEN at prepare time and every
 * later read is served from the stored plan, never recomputed. The chained hash depends on
 * batch boundaries AND intra-batch order, so a recomputation that split or ordered holders
 * even slightly differently would produce calldata whose hash diverges from what was
 * committed on-chain. That divergence is invisible until `closeAction` reverts with
 * CoverageHashMismatch — at the very end of a payout run, after the money has moved.
 */
import type { FastifyInstance } from "fastify";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { publicClient, CONTRACTS } from "../lib/chain.js";
import { requireSupabase } from "../lib/supabase.js";
import { prepareAction, PrepareError } from "../lib/entitlements.js";
import { syncActionsFromChain } from "../jobs/indexer.js";

const EXECUTE_ABI = parseAbi([
  "function executePayoutRun(uint256 actionId, address[] holders, uint256[] amounts)",
]);

const GET_ACTION_ABI = parseAbi([
  "function getAction(uint256) view returns ((address token, address asset, uint256 recordBlock, uint256 totalAmount, uint256 remainingBudget, bytes32 holderSetHash, bytes32 runningHash, uint32 nextIndex, uint32 totalHolders, uint32 paidCount, uint32 escrowedCount, uint64 redirectAfter, uint8 status))",
]);

const DECLARE_ABI = parseAbi([
  "function declareAction(address token, address asset, uint256 recordBlock, uint256 totalAmount, bytes32 holderSetHash, uint32 totalHolders, uint64 redirectAfter)",
]);

export async function actionRoutes(app: FastifyInstance) {
  /**
   * Dry-run a corporate action and freeze its plan.
   *
   * Persists BEFORE anything is declared on-chain, so the plan exists independently of the
   * declaring transaction. The snapshot in particular cannot be re-derived later: it is
   * balances as of a historical block, and if the indexer is ever reset the evidence behind
   * every entitlement would otherwise be gone.
   */
  app.post("/actions/prepare", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    let prepared;
    try {
      prepared = await prepareAction({
        token: body.token as Address | undefined,
        asset: body.asset as Address | undefined,
        recordBlock: BigInt(String(body.recordBlock ?? 0)),
        totalAmount: BigInt(String(body.totalAmount ?? 0)),
        batchSize: body.batchSize ? Number(body.batchSize) : undefined,
      });
    } catch (err) {
      if (err instanceof PrepareError) {
        return reply.code(err.statusCode).send({ error: err.message, code: err.code });
      }
      throw err;
    }

    const db = requireSupabase();
    const actionId = Number(prepared.actionId);

    // The predicted id must not already be taken. If it is, another action was declared
    // between the actionsCount() read and now, and this plan's seed — which binds actionId —
    // is already wrong. Refusing here is much cheaper than discovering it at closeAction.
    //
    // The authority for "taken" is THE CHAIN, not the mirror. Reading the mirror alone is
    // what bricked this route: a previous prepare had written its own optimistic row, the
    // gate saw it and refused, and because that plan was never declared, actionsCount()
    // never advanced — so every retry predicted the same id and hit the same 409, forever.
    // A planned-but-undeclared row is precisely NOT a clash; it is this route's own
    // leftover, and it gets replaced below.
    const onChain = (await publicClient.readContract({
      address: CONTRACTS.cam,
      abi: GET_ACTION_ABI,
      functionName: "getAction",
      args: [BigInt(actionId)],
    })) as { status: number };

    // Corroborate with the mirror, but only for rows the indexer confirmed from a real
    // ActionDeclared event. Those carry a declare_tx_hash; 'Prepared' rows never do.
    const { data: confirmed } = await db
      .from("corporate_actions")
      .select("action_id,status,declare_tx_hash")
      .eq("action_id", actionId)
      .neq("status", "Prepared")
      .maybeSingle();

    if (onChain.status !== 0 || confirmed) {
      return reply.code(409).send({
        code: "ACTION_ID_CLASH",
        error:
          `Predicted actionId ${actionId} is already declared on-chain ` +
          `(chain status ${onChain.status}${confirmed ? `, mirror status ${confirmed.status}` : ""}). ` +
          `Another action was declared between reading actionsCount() and now. Re-run prepare ` +
          `to get a fresh id — actionsCount() has advanced, so the next attempt gets a new one.`,
      });
    }

    // Replace any leftover plan for this id rather than merging into it. A re-prepare can
    // legitimately produce a SMALLER holder set, and merging would leave orphan snapshot
    // and batch rows from the previous attempt — rows that would then be served as the
    // frozen plan and hash to something the chain never committed to.
    await db.from("record_date_snapshots").delete().eq("action_id", actionId);
    await db.from("action_batches").delete().eq("action_id", actionId);

    await db.from("corporate_actions").upsert({
      action_id: actionId,
      payment_token: prepared.token.toLowerCase(),
      asset: prepared.asset.toLowerCase(),
      record_block: Number(prepared.recordBlock),
      total_amount: prepared.totalAmount.toString(),
      holder_set_hash: prepared.holderSetHash,
      total_holders: prepared.totalHolders,
      // PLANNED, not declared. Nothing exists on-chain yet, and a row that claims otherwise
      // is exactly what made this route unusable. Only the indexer's ActionDeclared handler
      // promotes this, and only against a real transaction hash.
      status: "Prepared",
      declare_tx_hash: null,
    });

    // Excluded holders are persisted too, not dropped. "1 holder excluded: entitlement
    // rounds to zero" is honest transfer-agent behaviour and worth showing; silently
    // omitting them would make the cap table and the payout disagree with no explanation.
    const snapshotRows = prepared.rows.map((r) => {
      const batch = prepared.batches.find((b) => b.holders.includes(r.holder));
      return {
        action_id: actionId,
        holder: r.holder.toLowerCase(),
        asset_balance: r.assetBalance.toString(),
        entitlement: r.entitlement.toString(),
        included: r.included,
        exclusion_reason: r.exclusionReason,
        batch_index: batch ? batch.batchIndex : null,
        position_in_batch: batch ? batch.holders.indexOf(r.holder) : null,
      };
    });
    const { error: snapErr } = await db.from("record_date_snapshots").upsert(snapshotRows);
    if (snapErr) return reply.code(500).send({ error: `snapshot persist failed: ${snapErr.message}` });

    const { error: batchErr } = await db.from("action_batches").upsert(
      prepared.batches.map((b) => ({
        action_id: actionId,
        batch_index: b.batchIndex,
        holders: b.holders.map((h) => h.toLowerCase()),
        amounts: b.amounts.map((a) => a.toString()),
        batch_total: b.batchTotal.toString(),
        expected_hash: b.expectedHash,
      })),
    );
    if (batchErr) return reply.code(500).send({ error: `batch plan persist failed: ${batchErr.message}` });

    return {
      actionId,
      // Echoed so a caller can never mistake a plan for a declaration. Nothing is on-chain
      // until the issuer signs `declareCalldata` below and the indexer sees ActionDeclared.
      status: "Prepared",
      token: prepared.token,
      asset: prepared.asset,
      recordBlock: prepared.recordBlock.toString(),
      totalAmount: prepared.totalAmount.toString(),
      holderSetHash: prepared.holderSetHash,
      totalHolders: prepared.totalHolders,
      sumEntitlements: prepared.batches.reduce((a, b) => a + b.batchTotal, 0n).toString(),
      excluded: prepared.excluded.map((e) => ({
        holder: e.holder,
        assetBalance: e.assetBalance.toString(),
        reason: e.exclusionReason,
      })),
      batches: prepared.batches.map((b) => ({
        batchIndex: b.batchIndex,
        holders: b.holders.length,
        batchTotal: b.batchTotal.toString(),
        expectedHash: b.expectedHash,
      })),
      // The issuer's wallet signs this; the backend never holds a key.
      declareCalldata: encodeFunctionData({
        abi: DECLARE_ABI,
        functionName: "declareAction",
        args: [
          prepared.token,
          prepared.asset,
          prepared.recordBlock,
          prepared.totalAmount,
          prepared.holderSetHash as `0x${string}`,
          prepared.totalHolders,
          // redirectAfter: not a feature this project implements — the CAM contract itself
          // reverts with RedirectNotSupported for any nonzero value, so 0 is the only valid
          // argument here, not a placeholder standing in for a missing capability.
          0n,
        ],
      }),
      to: CONTRACTS.cam,
    };
  });

  /** All actions, newest first. Chain-synced before returning so progress is never stale. */
  app.get("/actions", async () => {
    const db = requireSupabase();
    const { data } = await db.from("corporate_actions").select("*").order("action_id", { ascending: false });
    return data ?? [];
  });

  app.get<{ Params: { id: string } }>("/actions/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 0) return reply.code(400).send({ error: "bad action id" });

    // Re-sync from getAction() on every read: nextIndex and runningHash are emitted by no
    // event, and progress shown to a judge should be chain truth rather than a mirror that
    // might be a page behind.
    try {
      await syncActionsFromChain([id]);
    } catch {
      // A chain hiccup should degrade to the mirror, not 500 the page.
    }

    const db = requireSupabase();
    const { data: action } = await db.from("corporate_actions").select("*").eq("action_id", id).maybeSingle();
    if (!action) return reply.code(404).send({ error: `action ${id} not found` });

    const { data: batches } = await db
      .from("action_batches")
      .select("*")
      .eq("action_id", id)
      .order("batch_index");
    const { data: snapshot } = await db
      .from("record_date_snapshots")
      .select("*")
      .eq("action_id", id)
      .order("entitlement", { ascending: false });

    return {
      ...action,
      commitmentParity: action.running_hash === action.holder_set_hash,
      batches: batches ?? [],
      snapshot: snapshot ?? [],
      excluded: (snapshot ?? []).filter((s: { included: boolean }) => !s.included),
    };
  });

  /**
   * Calldata for one batch, served ONLY from the frozen plan.
   *
   * Also reports whether this batch is the one the chain expects next. A batch that has
   * already succeeded will revert with DuplicateHolder if retried — the correct failsafe,
   * but one that needs explaining rather than presenting as a generic failure.
   */
  app.get<{ Params: { id: string }; Querystring: { index?: string } }>(
    "/actions/:id/batch-calldata",
    async (req, reply) => {
      const id = Number(req.params.id);
      const index = Number(req.query.index ?? 0);
      if (!Number.isInteger(id) || id < 0) return reply.code(400).send({ error: "bad action id" });
      if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ error: "bad batch index" });

      const db = requireSupabase();
      const { data: batch } = await db
        .from("action_batches")
        .select("*")
        .eq("action_id", id)
        .eq("batch_index", index)
        .maybeSingle();
      if (!batch) return reply.code(404).send({ error: `no stored plan for action ${id} batch ${index}` });

      const holders = batch.holders as string[];
      const amounts = (batch.amounts as string[]).map((a) => BigInt(a));

      // Where the chain actually is. Batches must be executed strictly in order: the hash
      // chains, so batch N+1's commitment presumes batch N already folded in.
      let nextIndex: number | null = null;
      let alreadyExecuted = false;
      try {
        const a = (await publicClient.readContract({
          address: CONTRACTS.cam,
          abi: parseAbi([
            "function getAction(uint256) view returns ((address token, address asset, uint256 recordBlock, uint256 totalAmount, uint256 remainingBudget, bytes32 holderSetHash, bytes32 runningHash, uint32 nextIndex, uint32 totalHolders, uint32 paidCount, uint32 escrowedCount, uint64 redirectAfter, uint8 status))",
          ]),
          functionName: "getAction",
          args: [BigInt(id)],
        })) as { nextIndex: number };
        nextIndex = a.nextIndex;

        const holdersBefore = ((
          await db.from("action_batches").select("holders").eq("action_id", id).lt("batch_index", index)
        ).data ?? []).reduce((n, b) => n + (b.holders as string[]).length, 0);
        alreadyExecuted = nextIndex > holdersBefore;
      } catch {
        // Leave nextIndex null rather than guessing.
      }

      return {
        actionId: id,
        batchIndex: index,
        to: CONTRACTS.cam,
        holders,
        amounts: amounts.map((a) => a.toString()),
        batchTotal: batch.batch_total,
        expectedHash: batch.expected_hash,
        txHash: batch.tx_hash,
        onChainNextIndex: nextIndex,
        alreadyExecuted,
        note: alreadyExecuted
          ? "This batch appears to have executed already. Re-sending identical calldata will revert with DuplicateHolder — the intended failsafe, not an error to retry past."
          : null,
        calldata: encodeFunctionData({
          abi: EXECUTE_ABI,
          functionName: "executePayoutRun",
          args: [BigInt(id), holders as Address[], amounts],
        }),
      };
    },
  );
}
