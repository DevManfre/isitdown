import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stringify } from "yaml";
import { CATALOG } from "../../adapters/catalog.ts";
import { discover, kindOf, type DiscoveryResult } from "../../adapters/discover.ts";
import { SOURCE_LOCALE, t } from "../../core/i18n/index.ts";

/**
 * `isitdown discover [path...] [--yaml|--json]` — roadmap 2.3.
 *
 * Reads a project's own files — manifests, compose files, `.env`, Terraform,
 * `go.mod`, a hosts file — and proposes the catalog providers it depends on,
 * each with the lines that gave it away. Offline: it reads the bundled catalog
 * and nothing else, so it works on a laptop with no instance running, and a
 * host the catalog does not know is listed rather than probed.
 *
 * `--yaml` prints a `services:` block ready to paste into a Light edition
 * `config.yml`, which is the shortest path from "this repo" to "this fleet".
 */
const translate = (key: string, params?: Record<string, string | number>): string => t(SOURCE_LOCALE, key, params);

export const DISCOVER_USAGE = translate("cli.discover.usage");

/** Directories that hold someone else's code or a build, never this project's dependencies. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "build", "vendor", ".venv", "venv", "__pycache__", ".terraform", "target", ".next"]);
const MAX_DEPTH = 8;
const MAX_FILE_BYTES = 1024 * 1024;

/** Every file under `paths` discovery can read, relative to the directory it was found from. */
export function collectFiles(paths: readonly string[]): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  const add = (absolute: string, shown: string): void => {
    if (kindOf(absolute) === null) return;
    const size = statSync(absolute).size;
    if (size > MAX_FILE_BYTES) return;
    files.push({ path: shown, content: readFileSync(absolute, "utf8") });
  };
  const walk = (dir: string, base: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(absolute, base, depth + 1);
      } else if (entry.isFile()) {
        add(absolute, relative(base, absolute));
      }
    }
  };
  for (const path of paths) {
    if (statSync(path).isDirectory()) walk(path, path, 0);
    else add(path, path);
  }
  return files;
}

export function renderText(result: DiscoveryResult): string {
  if (result.files.length === 0) return `${translate("cli.discover.no-files")}\n`;
  const lines = [translate("cli.discover.read", { files: result.files.length }), ""];
  if (result.providers.length === 0) lines.push(translate("cli.discover.none"));
  for (const provider of result.providers) {
    lines.push(`${provider.entry.name} (${provider.entry.id})`);
    for (const evidence of provider.evidence) lines.push(`    ${evidence.file}: ${evidence.found}`);
  }
  if (result.unmatchedHosts.length > 0) {
    lines.push("", translate("cli.discover.unmatched"));
    for (const host of result.unmatchedHosts) lines.push(`    ${host}`);
  }
  if (result.providers.length > 0) lines.push("", translate("cli.discover.next"));
  return `${lines.join("\n")}\n`;
}

/** A `services:` block for a Light edition `config.yml`. */
export function renderYaml(result: DiscoveryResult): string {
  return stringify({
    services: result.providers.map(({ entry }) => ({
      name: entry.name,
      id: entry.id,
      adapter: entry.adapter,
      baseUrl: entry.baseUrl,
    })),
  });
}

export function main(argv: readonly string[]): number {
  const paths: string[] = [];
  let format: "text" | "yaml" | "json" = "text";
  for (const arg of argv) {
    if (arg === "--yaml") format = "yaml";
    else if (arg === "--json") format = "json";
    else if (arg.startsWith("-")) {
      process.stderr.write(`${translate("cli.error.unknownOption", { option: arg })}\n\n${DISCOVER_USAGE}`);
      return 2;
    } else paths.push(arg);
  }

  let files: { path: string; content: string }[];
  try {
    files = collectFiles(paths.length === 0 ? ["."] : paths);
  } catch (error) {
    process.stderr.write(`${translate("cli.discover.error.read", { reason: error instanceof Error ? error.message : String(error) })}\n`);
    return 1;
  }
  const result = discover(files, CATALOG);
  process.stdout.write(
    format === "yaml" ? renderYaml(result) : format === "json" ? `${JSON.stringify(result, null, 2)}\n` : renderText(result),
  );
  return 0;
}
