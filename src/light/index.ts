import { createLogWriter, readFileLogOptions } from "../core/logFile.ts";
import { createLogger, parseLogLevel } from "../core/logger.ts";
import { buildLightRuntime } from "./runtime.ts";

const CONFIG_PATH = process.env["CONFIG_PATH"] ?? "/app/config/config.yml";
const DATA_PATH = process.env["DATA_PATH"] ?? "/app/data/state.json";

/**
 * The whole edition, in one function.
 *
 * It reads as top-level code with an extra pair of braces, and the braces are
 * the point: a single-binary build (roadmap 6.7) bundles this entry to
 * CommonJS, which has no top-level `await` to bundle it *to*. Keeping the
 * awaits inside a function costs a line and makes the same source serve both
 * `node dist/light/index.js` and the binary.
 */
async function main(): Promise<void> {
  const logger = createLogger(
    parseLogLevel(process.env["LOG_LEVEL"]),
    createLogWriter(readFileLogOptions(process.env)),
  );

  let started: Awaited<ReturnType<typeof buildLightRuntime>>;
  try {
    started = await buildLightRuntime({
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
}

void main();
