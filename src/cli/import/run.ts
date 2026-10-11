import { readFileSync } from "node:fs";
import { stringify } from "yaml";
import { CATALOG } from "../../adapters/catalog.ts";
import { IMPORT_TOOLS, importMonitors, type ImportResult, type ImportTool } from "../../adapters/import/index.ts";
import { SOURCE_LOCALE, t } from "../../core/i18n/index.ts";

/**
 * `isitdown import <file> [--from <tool>] [--yaml|--json]` — roadmap 2.4.
 *
 * Reads another monitoring tool's export — an Uptime Kuma backup, a Gatus
 * `config.yaml`, a Statping export, a StatusGator monitor list — and says what
 * it becomes here, before anything is added. Offline, like `discover`: the
 * bundled catalog is the only other thing read.
 *
 * `--yaml` prints a `services:` block for the Light edition's `config.yml`,
 * heartbeats left out with a comment saying why: the Light edition has no URL a
 * job could call, and would refuse the whole file over one.
 */

const translate = (key: string, params?: Record<string, string | number>): string => t(SOURCE_LOCALE, key, params);

export const IMPORT_USAGE = translate("cli.import.usage");

export function renderText(result: ImportResult): string {
  const count = (kind: string): number => result.services.filter((entry) => entry.kind === kind).length;
  const lines = [
    translate("cli.import.read", {
      tool: translate(`cli.import.tool.${result.tool}`),
      monitors: result.services.length + result.skipped.length,
    }),
    translate("cli.import.summary", {
      services: result.services.length,
      probes: count("probe"),
      pages: count("page"),
      heartbeats: count("heartbeat"),
      skipped: result.skipped.length,
    }),
  ];

  for (const kind of ["probe", "page", "heartbeat"] as const) {
    const entries = result.services.filter((entry) => entry.kind === kind);
    if (entries.length === 0) continue;
    lines.push("", translate(`cli.import.section.${kind}`));
    for (const { source, service } of entries) {
      lines.push(translate("cli.import.line", { source, id: service.id, adapter: service.adapter }));
    }
  }

  const noted = result.services.filter((entry) => entry.notes.length > 0);
  if (noted.length > 0) {
    lines.push("", translate("cli.import.section.notes"));
    for (const { source, notes } of noted) {
      for (const note of notes) {
        const text = translate(`cli.import.note.${note.code}`);
        lines.push(translate("cli.import.noted", { source, note: note.detail === undefined ? text : `${text} — ${note.detail}` }));
      }
    }
  }

  if (result.skipped.length > 0) {
    lines.push("", translate("cli.import.section.skipped"));
    for (const { source, type, reason, detail } of result.skipped) {
      const text = translate(`cli.import.reason.${reason}`);
      lines.push(translate("cli.import.skipped", { source, type, reason: detail === undefined ? text : `${text} — ${detail}` }));
    }
  }

  if (result.services.length > 0) lines.push("", translate("cli.import.next"));
  return `${lines.join("\n")}\n`;
}

/** A `services:` block for the Light edition's `config.yml`, heartbeats left out. */
export function renderYaml(result: ImportResult): string {
  const heartbeats = result.services.filter((entry) => entry.kind === "heartbeat").length;
  const body = stringify({ services: result.services.filter((entry) => entry.kind !== "heartbeat").map((entry) => entry.service) });
  return heartbeats === 0 ? body : `${translate("cli.import.yaml.heartbeats", { count: heartbeats })}\n${body}`;
}

export function main(argv: readonly string[]): number {
  let file: string | undefined;
  let tool: ImportTool | undefined;
  let format: "text" | "yaml" | "json" = "text";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--yaml") format = "yaml";
    else if (arg === "--json") format = "json";
    else if (arg === "--from") {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined) {
        process.stderr.write(`${translate("cli.error.missingValue", { option: "--from" })}\n\n${IMPORT_USAGE}`);
        return 2;
      }
      if (!(IMPORT_TOOLS as readonly string[]).includes(value)) {
        process.stderr.write(`${translate("cli.import.error.from", { tools: IMPORT_TOOLS.join(", ") })}\n`);
        return 2;
      }
      tool = value as ImportTool;
    } else if (arg.startsWith("-")) {
      process.stderr.write(`${translate("cli.error.unknownOption", { option: arg })}\n\n${IMPORT_USAGE}`);
      return 2;
    } else if (file === undefined) {
      file = arg;
    } else {
      process.stderr.write(`${translate("cli.import.error.oneFile")}\n\n${IMPORT_USAGE}`);
      return 2;
    }
  }
  if (file === undefined) {
    process.stderr.write(`${translate("cli.import.error.noFile")}\n\n${IMPORT_USAGE}`);
    return 2;
  }

  let result: ImportResult;
  try {
    result = importMonitors(readFileSync(file, "utf8"), CATALOG, tool);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${translate("cli.import.error.read", { file, reason })}\n`);
    return 1;
  }
  process.stdout.write(
    format === "yaml" ? renderYaml(result) : format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderText(result),
  );
  return 0;
}
