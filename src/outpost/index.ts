import { getAdapter } from "../adapters/index.ts";
import { createLogWriter, readFileLogOptions } from "../core/logFile.ts";
import { createLogger, parseLogLevel } from "../core/logger.ts";
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
  const token = process.env["OUTPOST_TOKEN"]?.trim() ?? "";
  if (token === "") {
    logger.error("isitdown outpost failed to start", { error: "OUTPOST_TOKEN is not set" });
    process.exit(1);
  }
  const port = Number(process.env["PORT"] ?? 8080);

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
