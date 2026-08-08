/**
 * Runs the indexer standalone.
 *
 * `npm run dev` now starts the indexer (and the poller) in-process, so this script is no
 * longer part of the normal boot sequence. It stays for backfills — catching the cursor
 * up over a large block range without booting the server, which is worth doing separately
 * because a backlog can take minutes and the server's 10s tick would just re-enter it.
 *
 *   npx tsx scripts/run-indexer.ts          one catch-up pass, then exit
 *   npx tsx scripts/run-indexer.ts --watch  stay running, polling every 10s
 *
 * Safe to kill at any point and safe to re-run: the cursor only advances after a page's
 * rows are committed, and every write is idempotent on (tx_hash, log_index). Killing this
 * mid-backfill and restarting it is a supported operation, not a recovery procedure.
 */
import { runIndexerOnce, startIndexer, getCursor } from "../src/jobs/indexer.js";
import { DEPLOY_BLOCKS } from "../src/lib/chain.js";

if (process.argv.includes("--watch")) {
  console.log("indexer: watching (ctrl-c to stop)");
  const stop = startIndexer(10_000, { log: (m) => console.log(m) });
  process.on("SIGINT", () => {
    stop();
    console.log("\nindexer: stopped");
    process.exit(0);
  });
} else {
  const started = Date.now();

  for (const [name, floor] of Object.entries(DEPLOY_BLOCKS)) {
    console.log(`  ${name}: resuming from cursor ${await getCursor(name, floor)} (floor ${floor})`);
  }

  const results = await runIndexerOnce({ onProgress: (m) => console.log(m) });

  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(6)} ${r.fromBlock}..${r.toBlock}  ${r.logs} logs`);
  }
}
