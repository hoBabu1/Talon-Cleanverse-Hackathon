/**
 * The Fastify app, built but not listening.
 *
 * Split out from `index.ts` so the same instance every route is served from can also be
 * driven in-process by `fastify.inject()`. That matters for the end-to-end flow test: it
 * exercises the REAL routes, against the real chain, the real Cleanverse sandbox and the
 * real Supabase project, without binding a port or racing a separately-started server.
 *
 * There is deliberately no test-only variant of this function. A flow test that assembled
 * its own app could drift from the one that actually runs, and the entire reason that test
 * exists is to catch bugs that live BETWEEN the layers — which is precisely where a
 * near-identical-but-not-identical wiring would hide one.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { env } from "./lib/env.js";
import { cleanverse } from "./lib/cleanverse.js";
import { reconcileCapTable, serializeReconciliation } from "./lib/reconcile.js";
import { holderRoutes } from "./routes/holders.js";
import { onboardRoutes } from "./routes/onboard.js";
import { identityRoutes } from "./routes/identity.js";
import { actionRoutes } from "./routes/actions.js";
import { escrowRoutes } from "./routes/escrow.js";
import { auditRoutes } from "./routes/audit.js";
import { startIndexer } from "./jobs/indexer.js";
import { startPoller } from "./jobs/poller.js";

export interface BuildAppOptions {
  logger?: boolean;
  /**
   * Start the indexer and A-Pass poller alongside the server.
   *
   * Off by default, and ON only from `index.ts` — i.e. only when the process is really
   * serving. The flow test builds this same app in-process and drives `runIndexerOnce()`
   * / `runPollerOnce()` itself at the exact points its assertions depend on; a background
   * loop writing the same mirror rows underneath it wouldn't be unsafe (both passes are
   * idempotent) but it would make "the chain and the mirror agree at THIS step" a race,
   * and burn RPC on every test run.
   */
  startJobs?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  /// Registered before any route. The frontend is a separate origin in every environment
  /// we run in (localhost:3000 -> localhost:4000 in dev, Vercel -> Railway in production),
  /// so without this every browser fetch fails preflight and the backend appears down.
  const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
  });

  /**
   * Proves the whole chain (env -> Cleanverse client -> server) is wired, end to end, AND
   * that the cap table currently adds up.
   *
   * The reconciliation is here rather than on a debug-only route on purpose: a cap table
   * that silently under-reports is this system's most dangerous failure, because every
   * individual row still looks right. Making it part of the health signal means drift is
   * noticed by monitoring rather than by someone reading the dashboard.
   *
   * A reconciliation failure does NOT make the service unhealthy — the API still works and
   * the escrow data is still correct. It is reported as its own flag so the two conditions
   * stay distinguishable.
   */
  app.get("/health", async () => {
    const probe = await cleanverse.queryDepositAtokenList("monad");

    let capTable: ReturnType<typeof serializeReconciliation> | { error: string };
    try {
      capTable = serializeReconciliation(await reconcileCapTable());
    } catch (err) {
      capTable = { error: (err as Error).message };
    }

    return {
      ok: probe.code === "0000",
      cleanverseReachable: probe.code === "0000",
      supabaseConfigured: Boolean(env.SUPABASE_URL),
      capTable,
    };
  });

  /** The same reconciliation, alone, for when you want the detail without the rest. */
  app.get("/debug/reconcile", async () =>
    // Explicitly uncached — the point of this route is to read the chain right now.
    serializeReconciliation(await reconcileCapTable({ fresh: true })),
  );

  await app.register(holderRoutes);
  await app.register(onboardRoutes);
  await app.register(identityRoutes);
  await app.register(actionRoutes);
  await app.register(escrowRoutes);
  await app.register(auditRoutes);

  if (opts.startJobs) {
    // `prepare` 409s while the indexer cursor is behind the record block, so the mirror
    // being live is a precondition for the app working at all — not an optional extra
    // process someone has to remember to start.
    const stopIndexer = startIndexer(10_000, { log: (m) => app.log.info(m) });
    const stopPoller = startPoller(30_000, { log: (m) => app.log.info(m) });
    app.log.info("indexer + A-Pass poller started in-process");

    // Without this, Ctrl+C (or any close()) leaves both setIntervals holding the event
    // loop open and still writing to Supabase after the server is gone.
    app.addHook("onClose", async () => {
      stopIndexer();
      stopPoller();
      app.log.info("indexer + A-Pass poller stopped");
    });
  }

  return app;
}
