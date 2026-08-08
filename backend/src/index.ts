import { env } from "./lib/env.js";
import { buildApp } from "./app.js";

/**
 * `startJobs: true` is set here and nowhere else: the indexer and poller belong to a
 * process that is actually serving, not to every caller that assembles the app (the
 * flow test drives both jobs itself, at the points its assertions depend on).
 */
const app = await buildApp({ startJobs: true });

/// `app.close()` fires the `onClose` hook that stops both jobs, so Ctrl+C doesn't leave a
/// dangling setInterval holding the event loop open and still writing to Supabase.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received — shutting down`);
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error(err);
        process.exit(1);
      },
    );
  });
}

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
