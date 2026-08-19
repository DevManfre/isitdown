import { createLogger, parseLogLevel } from "../core/logger.ts";
import { buildLightRuntime } from "./runtime.ts";

const CONFIG_PATH = process.env["CONFIG_PATH"] ?? "/app/config/config.yml";
const DATA_PATH = process.env["DATA_PATH"] ?? "/app/data/state.json";

const logger = createLogger(parseLogLevel(process.env["LOG_LEVEL"]));

let runtime: Awaited<ReturnType<typeof buildLightRuntime>> | undefined;

try {
  runtime = await buildLightRuntime({
    configPath: CONFIG_PATH,
    dataPath: DATA_PATH,
    env: process.env,
    logger,
  });
} catch (error) {
  // Refusing to start with a message is worth more than starting silently and
  // never notifying: this is the first thing an operator reads in docker logs.
  logger.error("isitdown light failed to start", {
    error: error instanceof Error ? error.message : String(error),
    configPath: CONFIG_PATH,
    dataPath: DATA_PATH,
  });
  process.exit(1);
}

const started = runtime;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info("shutting down", { signal });
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
}

logger.info("isitdown light started", { configPath: CONFIG_PATH, dataPath: DATA_PATH });
await started.scheduler.start();
