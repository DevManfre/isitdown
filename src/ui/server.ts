import { createLogger, parseLogLevel } from "../core/logger.ts";
import { buildUiRuntime } from "./runtime.ts";

const DB_PATH = process.env["DB_PATH"] ?? "/app/data/isitdown.db";
const PORT = Number(process.env["PORT"] ?? 3000);

const logger = createLogger(parseLogLevel(process.env["LOG_LEVEL"]));

let runtime: Awaited<ReturnType<typeof buildUiRuntime>> | undefined;
try {
  runtime = await buildUiRuntime({ dbPath: DB_PATH, env: process.env, logger });
} catch (error) {
  logger.error("isitdown ui failed to start", {
    error: error instanceof Error ? error.message : String(error),
    dbPath: DB_PATH,
  });
  process.exit(1);
}

const started = runtime;
const server = started.app.listen(PORT, () => {
  logger.info("isitdown ui started", { port: PORT, dbPath: DB_PATH });
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info("shutting down", { signal });
    server.close(() => {
      void started
        .close()
        .catch((error: unknown) => {
          logger.error("shutdown failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          process.exit(0);
        });
    });
  });
}

// Reconstruct the 90-day charts before the first poll writes a real sample.
await started.backfill.backfillAll();
await started.scheduler.start();

started.mapLane.start();
// One immediate pass so a fresh container has markers on the map before the
// first quarter-hour interval elapses, rather than an empty card until then.
void started.mapLane.refresh().catch((error: unknown) => {
  logger.error("initial map refresh failed", {
    error: error instanceof Error ? error.message : String(error),
  });
});
