import { dirname, join } from "node:path";
import { createLogWriter, readFileLogOptions } from "../core/logFile.ts";
import { createLogger, parseLogLevel } from "../core/logger.ts";
import { configureOutbound, parseAllowList, unusableAllowEntries } from "../core/outboundPolicy.ts";
import { useEnvProxy } from "../core/proxy.ts";
import { applySecretFiles } from "../core/secretEnv.ts";
import { createChatops } from "./chatops.ts";
import { buildUiRuntime } from "./runtime.ts";
import { REVISION_CHECK_INTERVAL_MS } from "./incidentRevisions.ts";
import { readBindHost } from "./bindHost.ts";
import { DatabaseCorruptError } from "./db/open.ts";
import { NewerDatabaseError, preUpgradeBackupName } from "./db/migrate.ts";
import { runMigrateDown } from "./migrateDownCommand.ts";
import { SOURCE_LOCALE, t } from "../core/i18n/index.ts";

const DB_PATH = process.env["DB_PATH"] ?? "/app/data/isitdown.db";
const PORT = Number(process.env["PORT"] ?? 3000);
const HOST = readBindHost(process.env);

const logger = createLogger(
  parseLogLevel(process.env["LOG_LEVEL"]),
  createLogWriter(readFileLogOptions(process.env)),
);

// Roadmap 9.4: every NAME_FILE becomes NAME before anything reads a secret.
try {
  applySecretFiles(process.env);
} catch (error) {
  logger.error("isitdown ui failed to start", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}

// Roadmap 9.1: anyone who can add a provider here — through the dashboard or
// an API token — could otherwise read the LAN, so loopback and private targets
// are refused unless EGRESS_ALLOW lists them.
configureOutbound({ privateTargets: "deny" });
// Roadmap 10.7: before anything reads the network, so the first request too.
useEnvProxy(process.env, logger);
for (const entry of unusableAllowEntries(parseAllowList(process.env["EGRESS_ALLOW"]))) {
  logger.warn("EGRESS_ALLOW entry ignored: neither an address, a CIDR range nor a host name", { entry });
}

// Roadmap 10.2: `--migrate-down <N>` takes the schema back for an image
// rollback, then exits — the server never starts, so nothing writes the newer
// schema back over it.
const migrateDownAt = process.argv.indexOf("--migrate-down");
if (migrateDownAt !== -1) process.exit(runMigrateDown(DB_PATH, process.argv[migrateDownAt + 1]));

let runtime: Awaited<ReturnType<typeof buildUiRuntime>> | undefined;
try {
  runtime = await buildUiRuntime({ dbPath: DB_PATH, env: process.env, logger, seedProviders: false, seedSelfMonitor: true });
} catch (error) {
  // Roadmap 10.4. A torn page is a state the operator recovers from by hand,
  // so it is said in words on stderr — what, where, and the three steps —
  // beside the structured line, never as a stack trace.
  if (error instanceof DatabaseCorruptError) {
    process.stderr.write(
      `${t(SOURCE_LOCALE, "ui.startup.dbCorrupt", { path: error.path, detail: error.detail })}\n`,
    );
  }
  // Roadmap 10.2. An image rolled back over a database a newer one upgraded:
  // which version it needs, and where the copy from before that upgrade is.
  if (error instanceof NewerDatabaseError) {
    process.stderr.write(
      `${t(SOURCE_LOCALE, "ui.startup.dbNewer", {
        path: DB_PATH,
        found: error.found,
        known: error.known,
        version: error.writtenBy ?? "?",
        backup: join(dirname(DB_PATH), "backups", preUpgradeBackupName(error.found)),
      })}\n`,
    );
  }
  logger.error("isitdown ui failed to start", {
    error: error instanceof Error ? error.message : String(error),
    dbPath: DB_PATH,
  });
  process.exit(1);
}

const started = runtime;
const server = started.app.listen(PORT, HOST, () => {
  logger.info("isitdown ui started", { host: HOST, port: PORT, dbPath: DB_PATH });
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info("shutting down", { signal });
    chatops?.stop();
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

// Roadmap 1.11. Read every feed back now and every few hours after, so an edit
// to an incident a provider already resolved is noticed within the day. Not
// awaited: it is a comparison lane, and boot must not wait on N history reads.
void started.revisions.checkAll();
setInterval(() => void started.revisions.checkAll(), REVISION_CHECK_INTERVAL_MS).unref();

// Roadmap 3.18. Started here rather than in the runtime builder, like the
// scheduler and the map lane, so tests never open a long poll to Telegram.
// Does nothing at all unless `TELEGRAM_CHATOPS=true`.
const chatops = await createChatops(started).catch((error: unknown) => {
  logger.error("telegram chatops failed to start", {
    error: error instanceof Error ? error.message : String(error),
  });
  return null;
});
chatops?.start();
// Only now is anything answering a press, so only now do Telegram messages grow
// Ack and Mute buttons (roadmap 3.1).
if (chatops !== null) started.interactiveChannels.add("telegram");
// One immediate pass so a fresh container has markers on the map before the
// first quarter-hour interval elapses, rather than an empty card until then.
void started.mapLane.refresh().catch((error: unknown) => {
  logger.error("initial map refresh failed", {
    error: error instanceof Error ? error.message : String(error),
  });
});
