import { formatUtc } from "../../core/i18n/index.ts";
import type { OverallStatus } from "./schema.ts";
import type { ConnectionMode, WatchState } from "./state.ts";
import type { Translate } from "./watcher.ts";

/** ANSI: clear the screen and move the cursor home, so each redraw replaces the last rather than scrolling. */
export const CLEAR_SCREEN = "\x1b[2J\x1b[H";

const STATUS_KEY: Record<OverallStatus, string> = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

/** No colour library: plain SGR codes, and only ever around text this same function also supplies. */
const STATUS_COLOR: Record<OverallStatus, string> = {
  operational: "\x1b[32m",
  degraded: "\x1b[33m",
  partial_outage: "\x1b[33m",
  major_outage: "\x1b[31m",
  unknown: "\x1b[90m",
};
const RESET = "\x1b[0m";

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function connectionLabel(connection: ConnectionMode, translate: Translate): string {
  switch (connection) {
    case "connecting":
      return translate("cli.watch.connection.connecting");
    case "streaming":
      return translate("cli.watch.connection.live");
    case "polling":
      return translate("cli.watch.connection.polling");
    case "error":
      return translate("cli.watch.connection.error");
  }
}

/**
 * Builds the whole panel as one string — a pure function of `state`, so it
 * is tested without a terminal (a real tty is a thin `process.stdout.write`
 * wrapper around this, in `run.ts`). No colour is used outside the status
 * column, so a redirected-to-file capture stays legible.
 */
export function render(url: string, state: WatchState, translate: Translate): string {
  const lines: string[] = [];
  lines.push(translate("cli.watch.title", { url }));
  lines.push(connectionLabel(state.connection, translate));
  if (state.errorMessage !== null) lines.push(state.errorMessage);
  lines.push("");

  const dash = translate("cli.watch.table.unknown");
  const since = (iso: string | null): string => (iso === null ? dash : formatUtc(iso));

  if (state.providers.length === 0) {
    lines.push(translate("cli.watch.empty"));
  } else {
    const nameWidth = Math.max(...state.providers.map((row) => row.name.length), translate("cli.watch.table.provider").length);
    const statusWidth = Math.max(
      ...state.providers.map((row) => translate(STATUS_KEY[row.status]).length),
      translate("cli.watch.table.status").length,
    );
    lines.push(
      `${pad(translate("cli.watch.table.provider"), nameWidth)}  ${pad(translate("cli.watch.table.status"), statusWidth)}  ${pad(translate("cli.watch.table.since"), 22)}  ${translate("cli.watch.table.lastSample")}`,
    );
    for (const row of state.providers) {
      const label = translate(STATUS_KEY[row.status]);
      const colored = `${STATUS_COLOR[row.status]}${pad(label, statusWidth)}${RESET}`;
      lines.push(`${pad(row.name, nameWidth)}  ${colored}  ${pad(since(row.since), 22)}  ${since(row.fetchedAt)}`);
    }
  }

  lines.push("");
  lines.push(translate("cli.watch.changes.heading"));
  if (state.changes.length === 0) {
    lines.push(translate("cli.watch.changes.empty"));
  } else {
    for (const change of state.changes) {
      lines.push(
        translate("cli.watch.changes.line", {
          at: formatUtc(change.at),
          provider: change.providerName,
          status: translate(STATUS_KEY[change.status]),
        }),
      );
    }
  }

  lines.push("");
  lines.push(translate("cli.watch.footer"));

  return lines.join("\n");
}
