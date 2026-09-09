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

const report = await checkConfig({ path, env: process.env, probe });

for (const finding of report.findings) {
  process.stderr.write(`${finding.level}: ${finding.message}\n`);
}

const errors = report.findings.filter((finding) => finding.level === "error").length;
const warnings = report.findings.length - errors;
const summary = [
  `${report.services} service${report.services === 1 ? "" : "s"} (${report.enabledServices} enabled)`,
  report.enabledChannels.length === 0
    ? "no channel enabled"
    : `channels: ${report.enabledChannels.join(", ")}`,
  report.probed ? "providers probed" : "file only, no provider read",
].join(", ");

if (report.ok) {
  process.stdout.write(`${path} is valid — ${summary}${warnings > 0 ? `, ${warnings} warning(s)` : ""}\n`);
  process.exit(0);
}

process.stderr.write(`${path} is not usable — ${errors} error(s), ${warnings} warning(s); ${summary}\n`);
process.exit(1);
