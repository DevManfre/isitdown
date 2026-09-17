import { registerPluginAdapters } from "../adapters/plugins.ts";
import { createLogger, parseLogLevel } from "../core/logger.ts";
import { checkConfig } from "./config/checkConfig.ts";

/**
 * `check` — validate a Light edition `config.yml` without starting a poller
 * (roadmap 6.12).
 *
 *   node dist/light/check.js [--probe] [path]
 *
 * Prints every problem rather than the first, and exits non-zero when any of
 * them is an error, so an operator can run it in their own CI the way we run
 * the test suite in ours. Offline unless `--probe` is passed.
 */
const USAGE = `usage: node dist/light/check.js [--probe] [path]

Validates a Light edition config.yml and exits non-zero when it is unusable.

  path      config file to read (default: $CONFIG_PATH, else /app/config/config.yml)
  --probe   also read every enabled provider's page and say which adapter it
            looks like — needs network access, so it is off by default
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const probe = args.includes("--probe");
const positional = args.filter((arg) => !arg.startsWith("-"));
const unknown = args.filter((arg) => arg.startsWith("-") && arg !== "--probe");

if (unknown.length > 0 || positional.length > 1) {
  process.stderr.write(
    `${unknown.length > 0 ? `unknown option: ${unknown.join(", ")}` : "at most one config path"}\n\n${USAGE}`,
  );
  process.exit(2);
}

const path = positional[0] ?? process.env["CONFIG_PATH"] ?? "/app/config/config.yml";

// Plugin adapters first, for the same reason the runtime loads them before
// reading the configuration (roadmap 1.13): a config naming a plugin's adapter
// is valid, and a check that had not loaded the plugins would report it as an
// unknown adapter and exit non-zero on a file that runs perfectly well. Any
// plugin that could not be loaded is a finding of its own, below.
const plugins = await registerPluginAdapters(process.env, createLogger(parseLogLevel(process.env["LOG_LEVEL"])));

const report = await checkConfig({ path, env: process.env, probe });

for (const problem of plugins.problems) {
  process.stderr.write(`error: plugin adapter — ${problem}\n`);
}

for (const finding of report.findings) {
  process.stderr.write(`${finding.level}: ${finding.message}\n`);
}

// Plugin problems count as errors here too, so the summary line and the exit
// code agree about how many things are wrong.
const errors =
  report.findings.filter((finding) => finding.level === "error").length + plugins.problems.length;
const warnings = report.findings.length - errors;
const summary = [
  `${report.services} service${report.services === 1 ? "" : "s"} (${report.enabledServices} enabled)`,
  report.enabledChannels.length === 0
    ? "no channel enabled"
    : `channels: ${report.enabledChannels.join(", ")}`,
  report.probed ? "providers probed" : "file only, no provider read",
].join(", ");

// A plugin that could not be loaded is an error even when the file itself is
// fine: the operator put it there on purpose, and a check that passed while a
// provider silently had no adapter would be worth nothing.
if (report.ok && plugins.problems.length === 0) {
  process.stdout.write(`${path} is valid — ${summary}${warnings > 0 ? `, ${warnings} warning(s)` : ""}\n`);
  process.exit(0);
}

process.stderr.write(`${path} is not usable — ${errors} error(s), ${warnings} warning(s); ${summary}\n`);
process.exit(1);
