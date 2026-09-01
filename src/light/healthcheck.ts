import { stat } from "node:fs/promises";
import { loadConfig } from "./config/loadConfig.ts";

/**
 * Liveness for a container with no server to probe: the state file's mtime is
 * the proof that a cycle completed, since every cycle writes it. Three intervals
 * of slack absorbs one slow or failed cycle without flapping.
 */
const CONFIG_PATH = process.env["CONFIG_PATH"] ?? "/app/config/config.yml";
const DATA_PATH = process.env["DATA_PATH"] ?? "/app/data/state.json";
const ALLOWED_INTERVALS = 3;

try {
  const config = await loadConfig(CONFIG_PATH, process.env);
  const maxAgeMs = config.polling.intervalMinutes * 60_000 * ALLOWED_INTERVALS;
  const { mtimeMs } = await stat(DATA_PATH);
  const ageMs = Date.now() - mtimeMs;

  if (ageMs > maxAgeMs) {
    process.stderr.write(
      `unhealthy: ${DATA_PATH} last written ${Math.round(ageMs / 1000)}s ago, allowed ${Math.round(maxAgeMs / 1000)}s\n`,
    );
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  process.stderr.write(`unhealthy: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
