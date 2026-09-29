import { SOURCE_LOCALE, t } from "../core/i18n/index.ts";
import { main as runWatchCommand, WATCH_USAGE } from "./watch/run.ts";

/**
 * `isitdown` — the terminal client (roadmap 17.7), a third entrypoint beside
 * Light and UI. It reads the UI edition's HTTP API; it never imports
 * `src/ui` itself (golden rule, `CLAUDE.md`) and carries no adapter, no
 * notifier, no state store of its own.
 *
 * One subcommand today. The dispatch exists anyway so a second one is an
 * addition here rather than a rewrite of what `watch` already owns.
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

if (command === "--help" || command === "-h" || command === undefined) {
  process.stdout.write(USAGE);
  process.exit(command === undefined ? 2 : 0);
}

process.stderr.write(`${t(SOURCE_LOCALE, "cli.error.unknownCommand", { command: command ?? "" })}\n\n${USAGE}`);
process.exit(2);
