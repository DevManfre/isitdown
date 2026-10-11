import { SOURCE_LOCALE, t } from "../core/i18n/index.ts";
import { main as runWatchCommand, WATCH_USAGE } from "./watch/run.ts";
import { DISCOVER_USAGE, main as runDiscoverCommand } from "./discover/run.ts";

/**
 * `isitdown` — the terminal client (roadmap 17.7), a third entrypoint beside
 * Light and UI. It reads the UI edition's HTTP API; it never imports
 * `src/ui` itself (golden rule, `CLAUDE.md`) and carries no adapter, no
 * notifier, no state store of its own.
 *
 * Two subcommands: `watch` reads an instance, `discover` (roadmap 2.3) reads
 * a project's files and needs no instance at all.
 */
const USAGE = t(SOURCE_LOCALE, "cli.usage");

const [command, ...rest] = process.argv.slice(2);

if (command === "watch") {
  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(WATCH_USAGE);
    process.exit(0);
  }
  const code = await runWatchCommand(rest, process.env);
  process.exit(code);
}

if (command === "discover") {
  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(DISCOVER_USAGE);
    process.exit(0);
  }
  process.exit(runDiscoverCommand(rest));
}

if (command === "--help" || command === "-h" || command === undefined) {
  process.stdout.write(USAGE);
  process.exit(command === undefined ? 2 : 0);
}

process.stderr.write(`${t(SOURCE_LOCALE, "cli.error.unknownCommand", { command: command ?? "" })}\n\n${USAGE}`);
process.exit(2);
