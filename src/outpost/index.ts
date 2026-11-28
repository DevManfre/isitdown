import { getAdapter } from "../adapters/index.ts";
import { createLogWriter, readFileLogOptions } from "../core/logFile.ts";
import { createLogger, parseLogLevel } from "../core/logger.ts";
import { configureOutbound } from "../core/outboundPolicy.ts";
import { useEnvProxy } from "../core/proxy.ts";
import { applySecretFiles } from "../core/secretEnv.ts";
import { createOutpostServer } from "./server.ts";

/**
 * The outpost entrypoint — roadmap 1.7. Runs from the Light image with its own
 * command; see `docs/docker.md` for the compose service.
 *
 * Refuses to start without a token: an outpost listening on a public VPS with
 * no credential would run probes for anybody who found the port.
 */
function main(): void {
  const logger = createLogger(
    parseLogLevel(process.env["LOG_LEVEL"]),
    createLogWriter(readFileLogOptions(process.env)),
  );
  // Roadmap 9.4: OUTPOST_TOKEN_FILE, like every other secret.
  try {
    applySecretFiles(process.env);
  } catch (error) {
    logger.error("isitdown outpost failed to start", { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
  const token = process.env["OUTPOST_TOKEN"]?.trim() ?? "";
  if (token === "") {
    logger.error("isitdown outpost failed to start", { error: "OUTPOST_TOKEN is not set" });
    process.exit(1);
  }
  const port = Number(process.env["PORT"] ?? 8080);
  // An outpost exists to probe from inside a network, so it reads private
  // targets like the Light edition it ships with — warning once per host.
  configureOutbound({ privateTargets: "warn", warn: (message, fields) => logger.warn(message, fields) });
  // Roadmap 10.7: an outpost inside a proxied network reads through the proxy too.
  useEnvProxy(process.env, logger);

  const server = createOutpostServer({ token, getAdapter, logger });
  server.listen(port, () => {
    logger.info("isitdown outpost started", { port });
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      logger.info("shutting down", { signal });
      server.close(() => process.exit(0));
    });
  }
}

main();
